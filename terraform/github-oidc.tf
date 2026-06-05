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
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_repository}:ref:refs/heads/main"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name               = "${var.project_name}-github-deploy"
  assume_role_policy = data.aws_iam_policy_document.github_deploy_trust.json
}

data "aws_iam_policy_document" "amplify_release" {
  statement {
    effect = "Allow"
    actions = [
      "amplify:StartJob",
      "amplify:GetJob",
      "amplify:ListJobs",
    ]
    resources = [
      "arn:aws:amplify:${var.region}:${data.aws_caller_identity.current.account_id}:apps/${aws_amplify_app.cashight.id}/branches/*/jobs/*",
    ]
  }
}

resource "aws_iam_role_policy" "amplify_release" {
  name   = "amplify-release"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.amplify_release.json
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN GitHub Actions variable."
}
