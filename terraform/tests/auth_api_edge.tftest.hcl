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
  target          = aws_api_gateway_rest_api.cashight
  override_during = plan
  values = {
    execution_arn = "arn:aws:execute-api:ap-southeast-1:123456789012:stub"
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

override_resource {
  target          = aws_lambda_alias.session_capabilities_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-session-capabilities-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.cost_explorer_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-cost-explorer-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.aws_invoices_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-aws-invoices-api:live"
  }
}

override_resource {
  target          = aws_lambda_alias.aws_invoice_summary_api_live
  override_during = plan
  values = {
    arn = "arn:aws:lambda:ap-southeast-1:123456789012:function:cashight-aws-invoice-summary-api:live"
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

run "aws_invoice_routes_have_exact_methods_scopes_and_aliases" {
  command = plan

  assert {
    condition = alltrue([
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/uploads"])) == toset(["post", "options"]),
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/uploads/{jobId}"])) == toset(["get", "options"]),
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices"])) == toset(["get", "options"]),
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/{yearMonth}"])) == toset(["get", "delete", "options"]),
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/dashboard"])) == toset(["get", "options"]),
      toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/summary"])) == toset(["post", "options"]),
    ])
    error_message = "AWS invoice routes must expose only the approved methods plus OPTIONS"
  }

  assert {
    condition = alltrue([
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/uploads"].post.security[0].CognitoAuth == ["cashight/write"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/uploads/{jobId}"].get.security[0].CognitoAuth == ["cashight/read"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices"].get.security[0].CognitoAuth == ["cashight/read"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/{yearMonth}"].get.security[0].CognitoAuth == ["cashight/read"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/{yearMonth}"].delete.security[0].CognitoAuth == ["cashight/write"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/dashboard"].get.security[0].CognitoAuth == ["cashight/read"],
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/summary"].post.security[0].CognitoAuth == ["cashight/read"],
    ])
    error_message = "AWS invoice mutations and reads must use exact write/read scopes"
  }

  assert {
    condition = alltrue([
      for route in [
        "/aws/invoices/uploads",
        "/aws/invoices/uploads/{jobId}",
        "/aws/invoices",
        "/aws/invoices/{yearMonth}",
        "/aws/invoices/dashboard",
      ] : strcontains(jsonencode(yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route]), "cashight-aws-invoices-api:live")
    ]) && strcontains(jsonencode(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/invoices/summary"]), "cashight-aws-invoice-summary-api:live")
    error_message = "Invoice routes must use their dedicated live aliases"
  }

  assert {
    condition     = aws_lambda_permission.api_aws_invoices.source_arn == "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*/aws/invoices*" && aws_lambda_permission.api_aws_invoice_summary.source_arn == "${aws_api_gateway_rest_api.cashight.execution_arn}/*/POST/aws/invoices/summary"
    error_message = "API Gateway invoke permissions must be scoped to invoice routes"
  }
}

# ── Session capabilities API ──────────────────────────────────────────────────

run "session_capabilities_lambda_is_least_privilege" {
  command = plan

  assert {
    condition     = aws_iam_role.lambda_session_capabilities_api.name == "cashight-session-capabilities-api-role"
    error_message = "Session capabilities must have a dedicated IAM role"
  }

  assert {
    condition     = length(data.aws_iam_policy_document.lambda_session_capabilities_api_permissions.statement) == 1
    error_message = "Session capabilities must have exactly one application permission statement"
  }

  assert {
    condition     = toset(one(data.aws_iam_policy_document.lambda_session_capabilities_api_permissions.statement).actions) == toset(["dynamodb:GetItem"])
    error_message = "Session capabilities must have DynamoDB GetItem only and no S3/SSM access"
  }

  assert {
    condition     = contains(one(data.aws_iam_policy_document.xray_write.statement).actions, "xray:PutTraceSegments")
    error_message = "Session capabilities must use the shared X-Ray write policy"
  }
}

run "session_capabilities_lambda_runtime" {
  command = plan

  assert {
    condition     = aws_lambda_function.session_capabilities_api.runtime == "nodejs22.x"
    error_message = "Session capabilities must run on Node.js 22"
  }

  assert {
    condition     = aws_lambda_function.session_capabilities_api.memory_size == 256
    error_message = "Session capabilities must use 256 MiB"
  }

  assert {
    condition     = aws_lambda_function.session_capabilities_api.timeout == 10
    error_message = "Session capabilities must use a 10-second timeout"
  }

  assert {
    condition     = aws_lambda_function.session_capabilities_api.tracing_config[0].mode == "Active"
    error_message = "Session capabilities must enable active tracing"
  }

  assert {
    condition     = aws_cloudwatch_log_group.lambda_session_capabilities_api.retention_in_days == 30
    error_message = "Session capabilities logs must be retained for 30 days"
  }

  assert {
    condition     = aws_lambda_alias.session_capabilities_api_live.name == "live"
    error_message = "Session capabilities must expose a live alias"
  }
}

run "session_capabilities_route_is_exact" {
  command = plan

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "/session/capabilities:")
    error_message = "REST API must include /session/capabilities"
  }

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "operationId: getSessionCapabilities")
    error_message = "Capabilities GET must use operationId getSessionCapabilities"
  }

  assert {
    condition     = strcontains(aws_api_gateway_rest_api.cashight.body, "cashight/read")
    error_message = "Capabilities GET must require cashight/read"
  }

  assert {
    condition     = aws_lambda_permission.api_session_capabilities.source_arn == "${aws_api_gateway_rest_api.cashight.execution_arn}/*/GET/session/capabilities"
    error_message = "API Gateway permission must be scoped to GET /session/capabilities"
  }
}

# ── Cost Explorer API ─────────────────────────────────────────────────────────

run "cost_explorer_routes_have_exact_methods_and_scopes" {
  command = plan

  assert {
    condition = alltrue([
      for route in [
        "/aws/cost-explorer/query",
        "/aws/cost-explorer/comparisons",
        "/aws/cost-explorer/dimensions",
        "/aws/cost-explorer/forecast",
        "/aws/cost-explorer/export",
      ] : toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route])) == toset(["post", "options"])
    ])
    error_message = "Each Cost Explorer operation route must expose POST and OPTIONS only"
  }

  assert {
    condition     = toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports"])) == toset(["get", "post", "options"])
    error_message = "Saved reports collection must expose GET, POST, and OPTIONS only"
  }

  assert {
    condition     = toset(keys(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports/{reportId}"])) == toset(["delete", "options"])
    error_message = "Saved report item must expose DELETE and OPTIONS only"
  }

  assert {
    condition = alltrue([
      for route in [
        "/aws/cost-explorer/query",
        "/aws/cost-explorer/comparisons",
        "/aws/cost-explorer/dimensions",
        "/aws/cost-explorer/forecast",
        "/aws/cost-explorer/export",
      ] : yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route].post.security[0].CognitoAuth == ["cashight/read"]
    ])
    error_message = "Cost query routes must require cashight/read"
  }

  assert {
    condition     = yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports"].get.security[0].CognitoAuth == ["cashight/read"] && yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports"].post.security[0].CognitoAuth == ["cashight/write"] && yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports/{reportId}"].delete.security[0].CognitoAuth == ["cashight/write"]
    error_message = "Saved-report reads and mutations must use exact read/write scopes"
  }
}

run "cost_explorer_routes_validate_and_share_one_alias" {
  command = plan

  assert {
    condition = alltrue([
      for route in [
        "/aws/cost-explorer/query",
        "/aws/cost-explorer/comparisons",
        "/aws/cost-explorer/dimensions",
        "/aws/cost-explorer/forecast",
        "/aws/cost-explorer/export",
      ] : yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route].post["x-amazon-apigateway-request-validator"] == "all"
    ])
    error_message = "Every Cost Explorer POST route must enable API Gateway request validation"
  }

  assert {
    condition = alltrue([
      for route in [
        "/aws/cost-explorer/query",
        "/aws/cost-explorer/comparisons",
        "/aws/cost-explorer/dimensions",
        "/aws/cost-explorer/forecast",
        "/aws/cost-explorer/export",
      ] : strcontains(yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route].post["x-amazon-apigateway-integration"].uri, "cashight-cost-explorer-api:live")
    ])
    error_message = "Every Cost Explorer operation must integrate with the one live Lambda alias"
  }

  assert {
    condition     = strcontains(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports"].get["x-amazon-apigateway-integration"].uri, "cashight-cost-explorer-api:live") && strcontains(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports"].post["x-amazon-apigateway-integration"].uri, "cashight-cost-explorer-api:live") && strcontains(yamldecode(aws_api_gateway_rest_api.cashight.body).paths["/aws/cost-explorer/reports/{reportId}"].delete["x-amazon-apigateway-integration"].uri, "cashight-cost-explorer-api:live")
    error_message = "Every saved-report route must integrate with the one live Lambda alias"
  }

  assert {
    condition     = aws_lambda_permission.api_cost_explorer.source_arn == "${aws_api_gateway_rest_api.cashight.execution_arn}/*/*/aws/cost-explorer/*"
    error_message = "API Gateway may invoke Cost Explorer only under /aws/cost-explorer/*"
  }

  assert {
    condition = alltrue([
      for route, methods in {
        "/aws/cost-explorer/query"              = "'POST,OPTIONS'"
        "/aws/cost-explorer/comparisons"        = "'POST,OPTIONS'"
        "/aws/cost-explorer/dimensions"         = "'POST,OPTIONS'"
        "/aws/cost-explorer/forecast"           = "'POST,OPTIONS'"
        "/aws/cost-explorer/export"             = "'POST,OPTIONS'"
        "/aws/cost-explorer/reports"            = "'GET,POST,OPTIONS'"
        "/aws/cost-explorer/reports/{reportId}" = "'DELETE,OPTIONS'"
      } : yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route].options["x-amazon-apigateway-integration"].responses.default.responseParameters["method.response.header.Access-Control-Allow-Methods"] == methods &&
      yamldecode(aws_api_gateway_rest_api.cashight.body).paths[route].options["x-amazon-apigateway-integration"].responses.default.responseParameters["method.response.header.Access-Control-Allow-Origin"] == "'https://cashight.nghuy.link'"
    ])
    error_message = "Every Cost Explorer preflight must expose only its route methods to the production origin"
  }
}

run "legacy_flags_reach_only_compatibility_consumers" {
  command = plan

  assert {
    condition = alltrue([
      for fn in [
        aws_lambda_function.uploads_api,
        aws_lambda_function.upload_status_api,
        aws_lambda_function.statements_api,
        aws_lambda_function.dashboard_api,
        aws_lambda_function.summary_api,
        aws_lambda_function.session_capabilities_api,
        aws_lambda_function.cost_explorer_api,
      ] : fn.environment[0].variables["ENABLE_LEGACY_AUTHZ_FALLBACK"] == tostring(var.enable_legacy_authz_fallback)
    ])
    error_message = "Auth compatibility flag must reach every request-authorizing Lambda"
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.auth_guard.environment[0].variables), "ENABLE_LEGACY_AUTHZ_FALLBACK") && !contains(keys(aws_lambda_function.parser_worker.environment[0].variables), "ENABLE_LEGACY_AUTHZ_FALLBACK")
    error_message = "Auth compatibility flag must not reach non-request-authorizing Lambdas"
  }

  assert {
    condition = alltrue([
      for fn in [
        aws_lambda_function.upload_status_api,
        aws_lambda_function.parser_worker,
        aws_lambda_function.statements_api,
        aws_lambda_function.dashboard_api,
      ] : fn.environment[0].variables["ENABLE_LEGACY_WORKSPACE_FALLBACK"] == tostring(var.enable_legacy_workspace_fallback)
    ])
    error_message = "Workspace compatibility flag must reach every legacy statement reader"
  }

  assert {
    condition     = !contains(keys(aws_lambda_function.auth_guard.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK") && !contains(keys(aws_lambda_function.uploads_api.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK") && !contains(keys(aws_lambda_function.summary_api.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK") && !contains(keys(aws_lambda_function.session_capabilities_api.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK") && !contains(keys(aws_lambda_function.cost_explorer_api.environment[0].variables), "ENABLE_LEGACY_WORKSPACE_FALLBACK")
    error_message = "Workspace compatibility flag must not reach Lambdas without a legacy statement path"
  }
}

# ── Smoke-test machine client ────────────────────────────────────────────────

run "smoke_client_is_machine_only_and_scoped" {
  command = plan

  # Client credentials is not a preference here. The API demands the cashight/*
  # scopes, and Cognito attaches custom scopes only to tokens from an OAuth
  # flow — AdminInitiateAuth and SRP return aws.cognito.signin.user.admin
  # alone, which authorizeRequest rejects. Changing this flow silently breaks
  # every authenticated smoke check with a 403.
  assert {
    condition     = toset(aws_cognito_user_pool_client.smoke.allowed_oauth_flows) == toset(["client_credentials"])
    error_message = "Smoke client must use client credentials; other flows do not carry the cashight scopes"
  }

  assert {
    condition     = toset(aws_cognito_user_pool_client.smoke.allowed_oauth_scopes) == toset(["cashight/read", "cashight/write"])
    error_message = "Smoke client must hold exactly the read and write scopes the smoke checks exercise"
  }

  # Client credentials requires a secret, and the workflow reads it from the
  # pool at deploy time so no credential is stored in GitHub.
  assert {
    condition     = aws_cognito_user_pool_client.smoke.generate_secret
    error_message = "Smoke client must have a secret to use the client-credentials flow"
  }

  # The API authorises on an AUTHZ record keyed by the token's sub, which for a
  # client-credentials token is the client id. Without this record every smoke
  # request is a 403. The item body interpolates that id and so is unknown at
  # plan time; what this pins is that the record lands in the table the API
  # actually reads.
  assert {
    condition     = aws_dynamodb_table_item.smoke_authorization.table_name == aws_dynamodb_table.cashight.name
    error_message = "Smoke authorization record must be written to the table the API reads"
  }
}
