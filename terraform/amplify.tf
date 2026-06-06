# AWS Amplify Hosting (SSR / WEB_COMPUTE) for Cashight.
#
# Hybrid IaC: Terraform owns the app, branch, build spec, and the service role
# (so the app-id is a Terraform output, not a manual console lookup). Two things
# stay manual on purpose:
#   1. Authorizing the Amplify GitHub App on the repo (a one-time browser OAuth
#      step Terraform can't click) — unless you supply `github_access_token`.
#   2. The *secret* env vars (GEMINI_API_KEY, PDF_PASSWORD, AUTH_SECRET,
#      AUTH_GOOGLE_*, AUTH_COGNITO_SECRET) — set in the console so they never
#      land in Terraform state.

variable "github_access_token" {
  type        = string
  sensitive   = true
  default     = ""
  description = <<-EOT
    Optional GitHub PAT (scopes: repo + admin:repo_hook) so Terraform can fully
    connect the repository and create the webhook. Leave empty to instead
    authorize the AWS Amplify GitHub App once in the console after `apply`.
  EOT
}

# Both the build "service role" and the SSR "compute role" are assumed by the
# Amplify service principal — they differ only in the permissions attached.
data "aws_iam_policy_document" "amplify_service_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["amplify.amazonaws.com"]
    }
  }
}

# --- Service role: used by Amplify for the build/deploy phase only. ---
# It does NOT need the statements bucket: nothing in the build touches S3.
resource "aws_iam_role" "amplify_service" {
  name               = "${var.project_name}-amplify-service"
  assume_role_policy = data.aws_iam_policy_document.amplify_service_trust.json
}

# --- Compute role: assumed by the SSR runtime (Lambda) at REQUEST time. ---
# This — not the service role — is the identity our server code (lib/storage.ts)
# runs as, so the statements-bucket policy must live here. Without a compute role
# the SSR runtime has no S3 credentials and every storage call fails with the
# "credentials are missing" hint. Wired to the app via `compute_role_arn` below.
resource "aws_iam_role" "amplify_compute" {
  name               = "${var.project_name}-amplify-compute"
  assume_role_policy = data.aws_iam_policy_document.amplify_service_trust.json
}

# Grant the SSR runtime read/write to the statements bucket (policy from iam.tf).
resource "aws_iam_role_policy_attachment" "amplify_compute_s3" {
  role       = aws_iam_role.amplify_compute.name
  policy_arn = aws_iam_policy.statements_rw.arn
}

# --- The Amplify app. ---
resource "aws_amplify_app" "cashight" {
  name                 = var.project_name
  repository           = "https://github.com/${var.github_repository}"
  platform             = "WEB_COMPUTE" # required for Next.js 15 SSR
  iam_service_role_arn = aws_iam_role.amplify_service.arn
  compute_role_arn     = aws_iam_role.amplify_compute.arn # SSR runtime identity (S3 access)
  build_spec           = file("${path.module}/../amplify.yml")
  access_token         = var.github_access_token != "" ? var.github_access_token : null

  # Non-secret, structural env vars only. Secrets are added in the console and
  # merged at runtime; `ignore_changes` below keeps Terraform from deleting them.
  #
  # NOTE: AWS_REGION is intentionally NOT set here — Amplify rejects env vars with
  # the reserved "AWS" prefix, and the WEB_COMPUTE (Lambda) runtime already injects
  # AWS_REGION automatically, set to this app's region (ap-southeast-1).
  environment_variables = {
    STATEMENTS_BUCKET   = aws_s3_bucket.statements.bucket
    AUTH_COGNITO_ID     = aws_cognito_user_pool_client.web.id
    AUTH_COGNITO_ISSUER = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
  }

  lifecycle {
    # access_token can't be read back after create; environment_variables are
    # merged with the console-set secrets — don't let TF clobber either.
    ignore_changes = [access_token, environment_variables]
  }

  tags = {
    Project = var.project_name
    Purpose = "Amplify Hosting SSR for Cashight"
  }
}

# --- The production branch. ---
resource "aws_amplify_branch" "main" {
  app_id      = aws_amplify_app.cashight.id
  branch_name = "main"
  framework   = "Next.js - SSR"
  stage       = "PRODUCTION"

  # GitHub Actions (deploy.yaml) is the sole deploy trigger — see Step 11
  # Option A. Native auto-build stays off so tests always gate prod.
  enable_auto_build           = false
  enable_pull_request_preview = false
}

output "amplify_app_id" {
  value       = aws_amplify_app.cashight.id
  description = "Set as the AMPLIFY_APP_ID GitHub Actions variable."
}

output "amplify_default_domain" {
  value       = aws_amplify_app.cashight.default_domain
  description = "Amplify default domain (xxxx.amplifyapp.com)."
}

output "amplify_app_url" {
  value       = "https://${aws_amplify_branch.main.branch_name}.${aws_amplify_app.cashight.default_domain}"
  description = "Production URL once the first deploy succeeds."
}
