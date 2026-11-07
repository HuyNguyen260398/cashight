# The backend image registry and the role cashight-v2's CI assumes to push
# images and deploy the v2 SPA. A separate role, not v1's cashight-github-deploy:
# changing that role's trust would be a v1 change, and this one admits only the
# cashight-v2 branch.

# ── ECR ──────────────────────────────────────────────────────────────────────

resource "aws_ecr_repository" "backend" {
  #checkov:skip=CKV_AWS_136:AES256 (AWS-managed) encryption; a customer-managed KMS key adds cost and key administration for one repository.
  name                 = "cashight-backend"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Keep the last 20 tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 20
        }
        action = { type = "expire" }
      },
    ]
  })
}

# ── GitHub Actions role (cashight-v2 branch only) ────────────────────────────

# Account-global, owned elsewhere; referenced, as in terraform/github-oidc.tf.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

locals {
  github_ci_subjects = ["repo:HuyNguyen260398/cashight:ref:refs/heads/cashight-v2"]
  user_pool_arn      = "arn:aws:cognito-idp:${var.region}:${local.account_id}:userpool/${data.terraform_remote_state.v1.outputs.cognito_user_pool_id}"
}

data "aws_iam_policy_document" "github_ci_trust" {
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

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = local.github_ci_subjects
    }
  }
}

resource "aws_iam_role" "github_ci" {
  name                 = "cashight-v2-github-ci"
  description          = "cashight-v2 CI: push backend images, deploy the v2 SPA."
  assume_role_policy   = data.aws_iam_policy_document.github_ci_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_ci" {
  statement {
    sid       = "EcrLogin"
    effect    = "Allow"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPush"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
      "ecr:BatchGetImage",
      "ecr:DescribeImages",
    ]
    resources = [aws_ecr_repository.backend.arn]
  }

  statement {
    sid    = "SpaDeploy"
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
    sid    = "SpaInvalidate"
    effect = "Allow"
    actions = [
      "cloudfront:CreateInvalidation",
      "cloudfront:GetInvalidation",
      "cloudfront:ListInvalidations",
    ]
    resources = [aws_cloudfront_distribution.frontend.arn]
  }

  # Smoke tests (Plan 4c) mint a token from the shared smoke client, as v1's
  # ReadSmokeClientSecret: describe only, on this pool only.
  statement {
    sid       = "ReadSmokeClientSecret"
    effect    = "Allow"
    actions   = ["cognito-idp:DescribeUserPoolClient"]
    resources = [local.user_pool_arn]
  }
}

resource "aws_iam_role_policy" "github_ci" {
  name   = "cashight-v2-ci"
  role   = aws_iam_role.github_ci.id
  policy = data.aws_iam_policy_document.github_ci.json
}
