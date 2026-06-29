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

# ── Outputs ───────────────────────────────────────────────────────────────────

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN GitHub Actions variable."
}
