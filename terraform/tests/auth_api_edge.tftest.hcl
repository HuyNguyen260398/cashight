# tests/auth_api_edge.tftest.hcl
# Plan-mode assertions for Task 12: Cognito SPA client, API Gateway, CloudFront edge.
# Run with: terraform test (from the terraform/ directory)

# ── Overrides: stub computed ARNs so templatefile() body is plan-time-known ──
# aws_api_gateway_rest_api.cashight.body is rendered by templatefile() using
# Lambda alias and Cognito user-pool ARNs that are unknown at plan time.
# These file-level overrides give them predictable values so strcontains()
# assertions on the rendered body can be evaluated during a plan-mode run.

override_resource {
  target          = aws_cognito_user_pool.users
  override_during = plan
  values = {
    arn = "arn:aws:cognito-idp:ap-southeast-1:123456789012:userpool/ap-southeast-1_stub"
  }
}

override_resource {
  target          = aws_lambda_alias.uploads_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-uploads-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.upload_status_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-upload-status-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.statements_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-statements-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.dashboard_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-dashboard-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.summary_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-summary-api:live"
  }
}

# ── Cognito SPA client ────────────────────────────────────────────────────────

run "spa_client_has_no_secret" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.spa.generate_secret == false
    error_message = "SPA client must have generate_secret = false (public PKCE client)"
  }
}

run "spa_client_code_flow_only" {
  command = plan

  assert {
    condition     = contains(aws_cognito_user_pool_client.spa.allowed_oauth_flows, "code")
    error_message = "SPA client must include the authorization_code flow"
  }

  assert {
    condition     = length(aws_cognito_user_pool_client.spa.allowed_oauth_flows) == 1
    error_message = "SPA client must use code flow ONLY — no implicit or client_credentials"
  }
}

run "spa_client_token_revocation" {
  command = plan

  assert {
    condition     = aws_cognito_user_pool_client.spa.enable_token_revocation == true
    error_message = "SPA client must have token revocation enabled"
  }
}

run "spa_client_has_read_and_write_scopes" {
  command = plan

  assert {
    condition     = contains(aws_cognito_user_pool_client.spa.allowed_oauth_scopes, "cashight/read")
    error_message = "SPA client must include cashight/read scope"
  }

  assert {
    condition     = contains(aws_cognito_user_pool_client.spa.allowed_oauth_scopes, "cashight/write")
    error_message = "SPA client must include cashight/write scope"
  }
}

run "cognito_resource_server_exists" {
  command = plan

  assert {
    condition     = aws_cognito_resource_server.cashight.identifier == "cashight"
    error_message = "Resource server identifier must be 'cashight'"
  }

  assert {
    condition     = length(aws_cognito_resource_server.cashight.scope) == 2
    error_message = "Resource server must define exactly two scopes: read and write"
  }
}

run "google_idp_configured" {
  command = plan
  assert {
    condition     = aws_cognito_identity_provider.google.provider_type == "Google"
    error_message = "Google IdP must have provider_type 'Google'"
  }
  assert {
    condition     = aws_cognito_identity_provider.google.attribute_mapping["username"] == "sub"
    error_message = "Google IdP must map username to 'sub'"
  }
}

# ── WAF ───────────────────────────────────────────────────────────────────────

run "api_waf_scope_is_regional" {
  command = plan

  assert {
    condition     = aws_wafv2_web_acl.api.scope == "REGIONAL"
    error_message = "API WAF ACL must have REGIONAL scope (not CLOUDFRONT)"
  }
}

# ── Frontend S3 (SEC-007) ─────────────────────────────────────────────────────

run "frontend_bucket_name_convention" {
  command = plan

  assert {
    condition     = startswith(aws_s3_bucket.frontend.bucket, "cashight-frontend-")
    error_message = "Frontend bucket name must start with 'cashight-frontend-'"
  }
}

run "frontend_bucket_public_access_blocked" {
  command = plan

  assert {
    condition     = aws_s3_bucket_public_access_block.frontend.block_public_acls == true
    error_message = "Frontend bucket must block public ACLs (SEC-007)"
  }

  assert {
    condition     = aws_s3_bucket_public_access_block.frontend.restrict_public_buckets == true
    error_message = "Frontend bucket must restrict public bucket access (SEC-007)"
  }
}

# ── CloudFront OAC ────────────────────────────────────────────────────────────

run "cloudfront_oac_origin_type_is_s3" {
  command = plan

  assert {
    condition     = aws_cloudfront_origin_access_control.frontend.origin_access_control_origin_type == "s3"
    error_message = "CloudFront OAC must have origin type 's3' (SEC-007)"
  }

  assert {
    condition     = aws_cloudfront_origin_access_control.frontend.signing_behavior == "always"
    error_message = "CloudFront OAC must always sign requests to S3"
  }
}

run "cloudfront_uses_https_only" {
  command = plan

  assert {
    condition     = aws_cloudfront_distribution.frontend.viewer_certificate[0].minimum_protocol_version == "TLSv1.2_2021"
    error_message = "CloudFront must enforce TLSv1.2_2021 minimum protocol version"
  }
}

# ── DNS — temporary hostname ──────────────────────────────────────────────────

run "frontend_temp_dns_hostname" {
  command = plan

  assert {
    condition     = aws_route53_record.frontend_temp.name == "next.cashight.nghuy.link"
    error_message = "Temporary DNS record must point next.cashight.nghuy.link at CloudFront (pre-cutover)"
  }
}

# ── GitHub OIDC trust ─────────────────────────────────────────────────────────

run "github_trust_allows_production_environment" {
  command = plan

  assert {
    condition     = strcontains(data.aws_iam_policy_document.github_deploy_trust.json, "environment:production")
    error_message = "GitHub deploy trust must allow 'environment:production' subject"
  }
}

run "github_trust_allows_main_branch" {
  command = plan

  assert {
    condition     = strcontains(data.aws_iam_policy_document.github_deploy_trust.json, "refs/heads/main")
    error_message = "GitHub deploy trust must allow 'refs/heads/main' subject"
  }
}

# ── API Gateway summary endpoint uses streaming invocations ───────────────────

run "summary_integration_uses_streaming_uri" {
  command = plan

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "response-streaming-invocations")
    error_message = "REST API body must reference /response-streaming-invocations for the /summaries Lambda integration"
  }
}

run "rest_api_routes_present" {
  command = plan
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/summaries")
    error_message = "REST API must include /summaries route"
  }
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/dashboard")
    error_message = "REST API must include /dashboard route"
  }
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/statements")
    error_message = "REST API must include /statements route"
  }
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/uploads")
    error_message = "REST API must include /uploads route"
  }
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/health")
    error_message = "REST API must include /health route"
  }
  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "CognitoAuth")
    error_message = "REST API body must reference CognitoAuth security scheme"
  }
}

run "api_waf_name_matches_project" {
  command = plan

  # ARNs are computed/unknown at plan time, so assert on static input attributes.
  assert {
    condition     = aws_wafv2_web_acl.api.name == "${var.project_name}-api"
    error_message = "API WAF ACL must be named '<project>-api'"
  }

  assert {
    condition     = aws_wafv2_web_acl.api.scope == "REGIONAL"
    error_message = "API WAF ACL associated with API Gateway must have REGIONAL scope"
  }
}
