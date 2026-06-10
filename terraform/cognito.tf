# The prod URL is the fixed Amplify branch domain. It can't be derived from
# aws_amplify_app here without a dependency cycle (amplify.tf already consumes
# this client's id/issuer), so it's hardcoded; override via tfvars if the domain
# changes (e.g. a custom domain).
variable "cognito_callback_urls" {
  type        = list(string)
  description = "OAuth redirect URIs for the Cognito app client (dev + prod)."
  default = [
    "http://localhost:3000/api/auth/callback/cognito",
    "https://cashight.nghuy.link/api/auth/callback/cognito",
    # Kept as fallback during the custom-domain cutover.
    "https://main.d256g033y75nc0.amplifyapp.com/api/auth/callback/cognito",
  ]
}

variable "cognito_logout_urls" {
  type        = list(string)
  description = "Post-logout redirect URIs for the Cognito Hosted UI (dev + prod)."
  default = [
    "http://localhost:3000/signin",
    "https://cashight.nghuy.link/signin",
    # Kept as fallback during the custom-domain cutover.
    "https://main.d256g033y75nc0.amplifyapp.com/signin",
  ]
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

resource "aws_cognito_user_pool_client" "web" {
  name         = "${var.project_name}-web"
  user_pool_id = aws_cognito_user_pool.users.id

  # Confidential client — NextAuth's Cognito provider uses a client secret.
  generate_secret = true

  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid", "email", "profile"]
  allowed_oauth_flows_user_pool_client = true
  supported_identity_providers         = ["COGNITO"]

  callback_urls = var.cognito_callback_urls
  logout_urls   = var.cognito_logout_urls

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
}

output "cognito_user_pool_id" {
  value = aws_cognito_user_pool.users.id
}

output "cognito_user_pool_client_id" {
  value = aws_cognito_user_pool_client.web.id
}

output "cognito_user_pool_client_secret" {
  value     = aws_cognito_user_pool_client.web.client_secret
  sensitive = true
}

# The OIDC issuer NextAuth needs (NOT the Hosted-UI domain).
output "cognito_issuer" {
  value = "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.users.id}"
}

output "cognito_hosted_ui_domain" {
  value = "https://${aws_cognito_user_pool_domain.users.domain}.auth.${var.region}.amazoncognito.com"
}
