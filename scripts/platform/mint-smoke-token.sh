#!/usr/bin/env bash
# Prints a short-lived Cognito access token for the smoke suite, minted with
# client credentials on the shared smoke client (the API requires the
# cashight/* scopes, which Cognito grants only through OAuth). Used by
# bring-up.sh and .github/workflows/v2-minimal-release.yaml.
#
# Reads COGNITO_USER_POOL_ID, COGNITO_SMOKE_CLIENT_ID and
# COGNITO_HOSTED_UI_DOMAIN from the environment, falling back to
# `gh variable get`. The client secret is never printed; on failure only the
# OAuth error code is.
set -euo pipefail

repo_var() {
  local value=${!1:-}
  [ -n "$value" ] || value=$(gh variable get "$1")
  printf '%s' "$value"
}

pool_id=$(repo_var COGNITO_USER_POOL_ID)
client_id=$(repo_var COGNITO_SMOKE_CLIENT_ID)
hosted_ui=$(repo_var COGNITO_HOSTED_UI_DOMAIN)

secret=$(aws cognito-idp describe-user-pool-client --user-pool-id "$pool_id" --client-id "$client_id" \
  --query 'UserPoolClient.ClientSecret' --output text)
response=$(curl -sS -X POST "$hosted_ui/oauth2/token" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -u "$client_id:$secret" \
  -d 'grant_type=client_credentials&scope=cashight/read cashight/write')
token=$(jq -r '.access_token // empty' <<<"$response")
if [ -z "$token" ]; then
  echo "mint-smoke-token: could not mint a smoke token: $(jq -r '.error // "unknown_error"' <<<"$response" 2>/dev/null || echo unknown_error)" >&2
  exit 1
fi
printf '%s\n' "$token"
