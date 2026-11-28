# tests/security_hardening.tftest.hcl
# Plan-mode assertions for the zero-cost security hardening
# (docs/superpowers/specs/2026-11-28-zero-cost-security-hardening-design.md):
# Cognito pool and clients, CSP, API throttling, alarms, Access Analyzer.
# Run with: terraform test (from the terraform/ directory)

# The spa client's callback list includes the CloudFront domain, which is
# unknown at plan; pin it so the URL assertions can be evaluated.
override_resource {
  target          = aws_cloudfront_distribution.frontend
  override_during = plan
  values          = { domain_name = "d111111abcdef8.cloudfront.net" }
}

# ── Cognito user pool ────────────────────────────────────────────────────────

run "user_pool_hardened" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool.users.mfa_configuration == "ON"
    error_message = "User pool must require MFA"
  }

  assert {
    condition     = aws_cognito_user_pool.users.deletion_protection == "ACTIVE"
    error_message = "User pool must have deletion protection"
  }

  assert {
    condition     = aws_cognito_user_pool.users.admin_create_user_config[0].allow_admin_create_user_only == true
    error_message = "Self sign-up must be disabled"
  }
}
