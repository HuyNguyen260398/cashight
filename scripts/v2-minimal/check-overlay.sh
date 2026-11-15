#!/usr/bin/env bash
# Compares the account values committed in deploy/cashight/overlays/v2-minimal
# with the live Terraform outputs of terraform/v2 and terraform/v2-minimal. A
# re-created resource (new bucket suffix, new certificate, new role) would
# otherwise break requests silently. apply.sh runs this before handing
# releases to CI.
#
# Inputs: `terraform output -json` of both roots, read live unless
# V2_OUTPUTS_JSON / MINIMAL_OUTPUTS_JSON name files holding them.
# Exit 1 with one FAIL line per differing or missing value.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

OVERLAY=deploy/cashight/overlays/v2-minimal

if [ -n "${V2_OUTPUTS_JSON:-}" ]; then
  v2=$(cat "$V2_OUTPUTS_JSON")
else
  v2=$(terraform -chdir=terraform/v2 output -json)
fi
if [ -n "${MINIMAL_OUTPUTS_JSON:-}" ]; then
  minimal=$(cat "$MINIMAL_OUTPUTS_JSON")
else
  minimal=$(terraform -chdir=terraform/v2-minimal output -json)
fi

failures=0
# expect <label> <committed value> <expected value>; an empty expected value
# means the output is missing, which is a failure too.
expect() {
  if [ -z "$3" ]; then
    echo "FAIL: $1: Terraform output missing" >&2
    failures=$((failures + 1))
  elif [ "$2" != "$3" ]; then
    echo "FAIL: $1: committed '$2', Terraform has '$3'" >&2
    failures=$((failures + 1))
  fi
}
out() { jq -r --arg k "$2" '.[$k].value // empty' <<<"$1"; }
env_value() { yq -r ".data.$1" "$OVERLAY/env.yaml"; }

expect TABLE_NAME "$(env_value TABLE_NAME)" "$(out "$v2" table_name)"
expect STATEMENTS_BUCKET "$(env_value STATEMENTS_BUCKET)" "$(out "$v2" statements_bucket_name)"
expect UPLOAD_BUCKET "$(env_value UPLOAD_BUCKET)" "$(out "$v2" uploads_bucket_name)"
expect EXPORT_BUCKET "$(env_value EXPORT_BUCKET)" "$(out "$v2" cost_exports_bucket_name)"
expect COGNITO_USER_POOL_ID "$(env_value COGNITO_USER_POOL_ID)" "$(out "$v2" cognito_user_pool_id)"

expect "Ingress certificate-arn" \
  "$(yq -r '.metadata.annotations["alb.ingress.kubernetes.io/certificate-arn"]' "$OVERLAY/ingress.yaml")" \
  "$(out "$minimal" api_certificate_arn)"
expect "images newName" \
  "$(yq -r '.images[] | select(.name == "cashight-backend") | .newName' "$OVERLAY/kustomization.yaml")" \
  "$(out "$v2" ecr_repository_url)"
expect "ServiceAccount eks.amazonaws.com/role-arn" \
  "$(yq -r '.metadata.annotations["eks.amazonaws.com/role-arn"]' "$OVERLAY/serviceaccount.yaml")" \
  "$(out "$minimal" api_role_arn)"

if [ "$failures" -gt 0 ]; then
  echo "check-overlay: $failures value(s) differ from Terraform" >&2
  exit 1
fi
echo "check-overlay: PASS"
