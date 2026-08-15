# Sensitive credentials for Google OAuth IdP (values come from tfvars / CI secrets)
variable "google_oauth_client_id" {
  type        = string
  sensitive   = true
  description = "Google OAuth 2.0 client ID for Cognito federation. Populate via tfvars or CI secret."
  default     = ""
}

variable "google_oauth_client_secret" {
  type        = string
  sensitive   = true
  description = "Google OAuth 2.0 client secret for Cognito federation. Populate via tfvars or CI secret."
  default     = ""
}

resource "aws_cognito_user_pool" "users" {
  name = "${var.project_name}-users"

  username_attributes      = ["email"]
  auto_verified_attributes = ["email"]
  mfa_configuration        = "OPTIONAL"

  password_policy {
    minimum_length    = 12
    require_lowercase = true
    require_uppercase = true
    require_numbers   = true
    require_symbols   = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  software_token_mfa_configuration {
    enabled = true
  }

  # SEC-003: auth-guard enforces ALLOWED_EMAIL before each token issuance and
  # at Google federation sign-up (pre_sign_up).
  lambda_config {
    pre_token_generation = aws_lambda_alias.auth_guard_live.arn
    pre_sign_up          = aws_lambda_alias.auth_guard_live.arn
  }

  tags = {
    Project = var.project_name
    Purpose = "App user authentication"
  }
}

# Hosted-UI domain. The prefix must be globally unique within the region.
resource "aws_cognito_user_pool_domain" "users" {
  domain       = "${var.project_name}-${var.bucket_suffix}"
  user_pool_id = aws_cognito_user_pool.users.id
}

# ── Resource server — defines the cashight/* custom scopes ───────────────────

resource "aws_cognito_resource_server" "cashight" {
  user_pool_id = aws_cognito_user_pool.users.id
  identifier   = "cashight"
  name         = "Cashight API"

  scope {
    scope_name        = "read"
    scope_description = "Read statements and dashboard data"
  }

  scope {
    scope_name        = "write"
    scope_description = "Upload statements and modify data"
  }
}

# ── Google Social IdP (federation) ───────────────────────────────────────────
# Apply only after KMS state encryption is active (production environment guard).
# Credentials come from sensitive tfvars / CI secrets — never hardcoded.

resource "aws_cognito_identity_provider" "google" {
  user_pool_id  = aws_cognito_user_pool.users.id
  provider_name = "Google"
  provider_type = "Google"

  # Cognito computes the endpoint metadata below for provider_type = "Google"
  # and returns it on read. Declaring only client_id/client_secret/scopes made
  # every plan show a diff that nulled all six, so they are pinned here to match
  # what Cognito actually stores. Terraform cannot mark them computed, so the
  # choice is to declare them or to ignore_changes the whole map — declaring is
  # preferred, since it keeps the config a faithful description of the resource.
  provider_details = {
    client_id                     = var.google_oauth_client_id
    client_secret                 = var.google_oauth_client_secret
    authorize_scopes              = "openid email profile"
    attributes_url                = "https://people.googleapis.com/v1/people/me?personFields="
    attributes_url_add_attributes = "true"
    authorize_url                 = "https://accounts.google.com/o/oauth2/v2/auth"
    oidc_issuer                   = "https://accounts.google.com"
    token_request_method          = "POST"
    token_url                     = "https://www.googleapis.com/oauth2/v4/token"
  }

  attribute_mapping = {
    email          = "email"
    username       = "sub"
    email_verified = "email_verified"
  }
}

# ── SPA public client (PKCE / code flow — no secret) ─────────────────────────

resource "aws_cognito_user_pool_client" "spa" {
  name         = "${var.project_name}-spa"
  user_pool_id = aws_cognito_user_pool.users.id

  # Public client — browser SPA uses PKCE; no client secret needed or safe here.
  generate_secret = false

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_flows_user_pool_client = true

  allowed_oauth_scopes = [
    "openid",
    "email",
    "profile",
    "cashight/read",
    "cashight/write",
  ]

  supported_identity_providers = ["COGNITO", "Google"]

  callback_urls = [
    "https://cashight.nghuy.link/auth/callback/",
    "https://${aws_cloudfront_distribution.frontend.domain_name}/auth/callback/",
    "http://localhost:3000/auth/callback/",
  ]

  logout_urls = [
    "https://cashight.nghuy.link/signin/",
    "https://${aws_cloudfront_distribution.frontend.domain_name}/signin/",
    "http://localhost:3000/signin/",
  ]

  prevent_user_existence_errors = "ENABLED"
  enable_token_revocation       = true
  access_token_validity         = 1
  id_token_validity             = 1
  refresh_token_validity        = 7

  token_validity_units {
    access_token  = "hours"
    id_token      = "hours"
    refresh_token = "days"
  }

  explicit_auth_flows = ["ALLOW_USER_SRP_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]

  # Wait for the Google IdP to exist before creating the client that references it.
  depends_on = [
    aws_cognito_resource_server.cashight,
    aws_cognito_identity_provider.google,
  ]
}

# ── Outputs ───────────────────────────────────────────────────────────────────

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_spa_client_id" {
  value       = aws_cognito_user_pool_client.spa.id
  description = "Public SPA client ID (no secret). Set as NEXT_PUBLIC_COGNITO_CLIENT_ID."
}

# The OIDC issuer NextAuth needs (NOT the Hosted-UI domain).
output "cognito_issuer" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

output "cognito_hosted_ui_domain" {
  value = "https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com"
}

# ── Smoke-test machine client ────────────────────────────────────────────────
# Deployment verification needs a token the API accepts, and the API requires
# the cashight/* scopes. Cognito only puts custom scopes on tokens issued
# through an OAuth flow: AdminInitiateAuth and the SRP/password flows return
# `aws.cognito.signin.user.admin` alone, which authorizeRequest rejects. Client
# credentials is therefore the only flow that yields a usable token without a
# browser, and it needs no user password stored anywhere.
#
# This client can only mint tokens for itself. It has no explicit_auth_flows,
# so it cannot authenticate a user, and no callback URLs, so it cannot take
# part in a browser sign-in.
resource "aws_cognito_user_pool_client" "smoke" {
  name         = "${var.project_name}-smoke"
  user_pool_id = aws_cognito_user_pool.users.id

  generate_secret = true

  allowed_oauth_flows                  = ["client_credentials"]
  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_scopes                 = ["cashight/read", "cashight/write"]

  enable_token_revocation = true
  access_token_validity   = 1

  token_validity_units {
    access_token = "hours"
  }

  depends_on = [aws_cognito_resource_server.cashight]
}

# The API authorises on an AUTHZ record keyed by the token's `sub`, which for a
# client-credentials token is the client id. auth-guard only writes these for
# human sign-ins, so the machine client needs its own record or every smoke
# request returns 403. authProvider is COGNITO because the token is issued by
# the pool itself — this is what lets the Cost Explorer checks run.
resource "aws_dynamodb_table_item" "smoke_authorization" {
  table_name = aws_dynamodb_table.cashight.name
  hash_key   = aws_dynamodb_table.cashight.hash_key
  range_key  = aws_dynamodb_table.cashight.range_key

  item = jsonencode({
    PK           = { S = "AUTHZ#${aws_cognito_user_pool_client.smoke.id}" }
    SK           = { S = "PROFILE" }
    active       = { BOOL = true }
    workspaceId  = { S = "primary" }
    authProvider = { S = "COGNITO" }
    createdAt    = { S = "2026-08-15T00:00:00.000Z" }
    updatedAt    = { S = "2026-08-15T00:00:00.000Z" }
  })
}

output "cognito_smoke_client_id" {
  value = aws_cognito_user_pool_client.smoke.id
}
