variable "github_repository" {
  type        = string
  description = "owner/repo permitted to assume the deploy role via OIDC."
  default     = "HuyNguyen260398/cashight"
}

variable "amplify_app_id" {
  type        = string
  description = "Amplify app id from the console (App settings → General)."
}

data "aws_caller_identity" "current" {}

# GitHub's OIDC provider is account-global. If one already exists in the
# account, import it instead of creating a duplicate:
#   terraform import aws_iam_openid_connect_provider.github \
#     arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
  # AWS validates the OIDC cert chain against its trusted CAs; the thumbprint
  # is no longer security-critical but the argument is still required.
  thumbprint_list = ["6938fd4d98bab03faadb97b34396831e3780aea1"]
}

data "aws_iam_policy_document" "github_deploy_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [aws_iam_openid_connect_provider.github.arn]
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
      "arn:aws:amplify:${var.region}:${data.aws_caller_identity.current.account_id}:apps/${var.amplify_app_id}/branches/*/jobs/*",
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
