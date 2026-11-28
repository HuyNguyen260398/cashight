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

# ── App clients ──────────────────────────────────────────────────────────────

run "spa_client_hardened" {
  command = plan

  assert {
    condition = length([
      for u in concat(
        tolist(aws_cognito_user_pool_client.spa.callback_urls),
        tolist(aws_cognito_user_pool_client.spa.logout_urls),
      ) : u if strcontains(u, "localhost") || strcontains(u, "cashight-v2")
    ]) == 0
    error_message = "Production client must not allow localhost or v2 redirects"
  }

  assert {
    condition     = contains(tolist(aws_cognito_user_pool_client.spa.callback_urls), "https://cashight.nghuy.link/auth/callback/")
    error_message = "Production callback must remain"
  }

  assert {
    condition     = aws_cognito_user_pool_client.spa.refresh_token_rotation[0].feature == "ENABLED"
    error_message = "Refresh token rotation must be enabled"
  }
}

run "dev_client_localhost_only" {
  command = plan

  assert {
    condition     = tolist(aws_cognito_user_pool_client.dev.callback_urls) == tolist(["http://localhost:3000/auth/callback/"])
    error_message = "Dev client callback must be localhost only"
  }

  assert {
    condition     = tolist(aws_cognito_user_pool_client.dev.logout_urls) == tolist(["http://localhost:3000/signin/"])
    error_message = "Dev client logout must be localhost only"
  }

  assert {
    condition     = aws_cognito_user_pool_client.dev.generate_secret == false
    error_message = "Dev client is a public PKCE client"
  }
}

# ── Content-Security-Policy ──────────────────────────────────────────────────

run "csp_report_only_by_default" {
  command = plan

  assert {
    condition     = length(aws_cloudfront_response_headers_policy.frontend.security_headers_config[0].content_security_policy) == 0
    error_message = "Report-only mode must not send an enforcing CSP"
  }

  assert {
    condition = anytrue([
      for h in aws_cloudfront_response_headers_policy.frontend.custom_headers_config[0].items :
      h.header == "Content-Security-Policy-Report-Only"
      && strcontains(h.value, "frame-ancestors 'none'")
      && strcontains(h.value, "https://api.cashight.nghuy.link")
      && strcontains(h.value, ".auth.ap-southeast-1.amazoncognito.com")
      && strcontains(h.value, ".s3.ap-southeast-1.amazonaws.com")
    ])
    error_message = "Report-only CSP header must carry the full policy"
  }
}

run "csp_enforced" {
  command = plan

  variables {
    csp_mode = "enforce"
  }

  assert {
    condition     = strcontains(aws_cloudfront_response_headers_policy.frontend.security_headers_config[0].content_security_policy[0].content_security_policy, "object-src 'none'")
    error_message = "Enforce mode must send the CSP"
  }

  assert {
    condition     = length(aws_cloudfront_response_headers_policy.frontend.custom_headers_config) == 0
    error_message = "Enforce mode must not also send the report-only header"
  }
}

run "csp_mode_rejects_unknown_value" {
  command = plan

  variables {
    csp_mode = "off"
  }

  expect_failures = [var.csp_mode]
}

# ── API throttling ───────────────────────────────────────────────────────────

run "api_throttle_tightened" {
  command = plan

  assert {
    condition     = aws_api_gateway_method_settings.cashight.settings[0].throttling_rate_limit == 10
    error_message = "API stage rate limit must be 10 rps"
  }

  assert {
    condition     = aws_api_gateway_method_settings.cashight.settings[0].throttling_burst_limit == 20
    error_message = "API stage burst limit must be 20"
  }
}
