variable "github_repository" {
  type        = string
  description = "owner/repo permitted to assume the deploy role via OIDC."
  default     = "HuyNguyen260398/cashight"
}

data "aws_caller_identity" "current" {}

# GitHub's OIDC provider is account-global — one per AWS account. It already
# exists in this account (created/owned by another Terraform config), so we
# *reference* it via a data source rather than manage it here. This avoids two
# configs fighting over the shared resource's tags/thumbprint on every apply.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Allow both the protected production environment AND the main branch so
    # Terraform plan/apply jobs (branch-scoped) and deploy jobs (environment-
    # scoped) both work with short-lived credentials.
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:${var.github_repository}:environment:production",
        "repo:${var.github_repository}:ref:refs/heads/main",
      ]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project_name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
}

# ── Lambda deployment (update code + publish version via CodeDeploy) ──────────

data "aws_iam_policy_document" "lambda_deploy" {
  statement {
    sid    = "LambdaArtifactWrite"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.artifacts.arn,
      "${aws_s3_bucket.artifacts.arn}/*",
    ]
  }

  statement {
    sid    = "LambdaUpdate"
    effect = "Allow"
    actions = [
      "lambda:UpdateFunctionCode",
      "lambda:PublishVersion",
      "lambda:GetFunction",
      "lambda:GetAlias",
      "lambda:UpdateAlias",
      "lambda:GetFunctionConfiguration",
    ]
    resources = [
      "arn:aws:lambda:${var.region}:${data.aws_caller_identity.current.account_id}:function:${var.project_name}-*",
    ]
  }

  statement {
    sid    = "CodeDeployDeploy"
    effect = "Allow"
    actions = [
      "codedeploy:CreateDeployment",
      "codedeploy:GetDeployment",
      "codedeploy:GetDeploymentConfig",
      "codedeploy:GetApplicationRevision",
      "codedeploy:RegisterApplicationRevision",
      "codedeploy:GetApplication",
    ]
    resources = [
      "arn:aws:codedeploy:${var.region}:${data.aws_caller_identity.current.account_id}:application:${var.project_name}-*",
      "arn:aws:codedeploy:${var.region}:${data.aws_caller_identity.current.account_id}:deploymentgroup:${var.project_name}-*/*",
      "arn:aws:codedeploy:${var.region}:${data.aws_caller_identity.current.account_id}:deploymentconfig:CodeDeployDefault.Lambda*",
    ]
  }
}

resource "aws_iam_role_policy" "lambda_deploy" {
  name   = "lambda-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.lambda_deploy.json
}

# ── CloudFront invalidation + S3 frontend deployment ─────────────────────────

data "aws_iam_policy_document" "frontend_deploy" {
  statement {
    sid    = "S3FrontendDeploy"
    effect = "Allow"
    actions = [
      "s3:PutObject",
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.frontend.arn,
      "${aws_s3_bucket.frontend.arn}/*",
    ]
  }

  statement {
    sid    = "CloudFrontInvalidate"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
      "cloudfront:ListInvalidations",
    ]
    resources = [
      aws_cloudfront_distribution.frontend.arn,
    ]
  }
}

resource "aws_iam_role_policy" "frontend_deploy" {
  name   = "frontend-deploy"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.frontend_deploy.json
}

# ── Terraform state read access ───────────────────────────────────────────────

data "aws_iam_policy_document" "terraform_state_read" {
  statement {
    sid    = "TfstateRead"
    effect = "Allow"
    actions = [
      "s3:GetObject",
      "s3:ListBucket",
    ]
    resources = [
      aws_s3_bucket.tfstate.arn,
      "${aws_s3_bucket.tfstate.arn}/*",
    ]
  }

  statement {
    sid    = "TfstateKmsDecrypt"
    effect = "Allow"
    actions = [
      "kms:Decrypt",
      "kms:DescribeKey",
      "kms:GenerateDataKey",
    ]
    resources = [aws_kms_key.tfstate.arn]
  }
}

resource "aws_iam_role_policy" "terraform_state_read" {
  name   = "terraform-state-read"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.terraform_state_read.json
}

# ── Terraform CI role ─────────────────────────────────────────────────────────
#
# infrastructure-deploy.yaml referenced vars.AWS_INFRA_ROLE_ARN, which was never
# set, and no matching role existed — the workflow had never run once. Every
# apply to date came from a workstation, which is why the deployed state drifted
# from what the repo could reproduce.
#
# Scope: Terraform here manages IAM roles and policies, so PowerUserAccess is not
# enough (it denies iam:*). This role is effectively account-admin. Two things
# keep that honest:
#
#   1. The trust condition below admits ONLY jobs that declare
#      `environment: production` — not any job running on main. Both the plan and
#      apply jobs declare it.
#   2. That makes GitHub's environment protection the gate. The production
#      environment currently has NO protection rules, so add required reviewers
#      to it — otherwise this is admin-on-merge with no human in the loop.
#
# If tighter scoping is wanted later, split this into a read-only plan role and
# an admin apply role, and give the plan job the read-only one.

data "aws_iam_policy_document" "github_infra_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    # Environment-scoped only — deliberately narrower than the deploy role, which
    # also admits refs/heads/main.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:environment:production"]
    }
  }
}

resource "aws_iam_role" "github_infra" {
  name                 = "${var.project_name}-github-infra"
  description          = "Terraform plan/apply from GitHub Actions. Admin-equivalent; gated by the production environment."
  assume_role_policy   = data.aws_iam_policy_document.github_infra_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy_attachment" "github_infra_admin" {
  role       = aws_iam_role.github_infra.name
  policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN GitHub Actions variable."
}

output "github_infra_role_arn" {
  value       = aws_iam_role.github_infra.arn
  description = "Set as the AWS_INFRA_ROLE_ARN GitHub Actions variable."
}
