#!/usr/bin/env bash
# Compares the account values committed in deploy/cashight/overlays/v2 and
# deploy/workloads/cashight.yaml with the live Terraform outputs. A re-created
# v2 resource (new bucket suffix, new certificate, new connection) would
# otherwise break every request silently. bring-up.sh runs this before smoke.
#
# Inputs: `terraform output -json` of terraform/v2 and terraform/platform, read
# live unless V2_OUTPUTS_JSON / PLATFORM_OUTPUTS_JSON name files holding them.
# Exit 1 with one FAIL line per differing or missing value.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

OVERLAY=deploy/cashight/overlays/v2
APPLICATION=deploy/workloads/cashight.yaml

if [ -n "${V2_OUTPUTS_JSON:-}" ]; then
  v2=$(cat "$V2_OUTPUTS_JSON")
else
  v2=$(terraform -chdir=terraform/v2 output -json)
fi
if [ -n "${PLATFORM_OUTPUTS_JSON:-}" ]; then
  platform=$(cat "$PLATFORM_OUTPUTS_JSON")
else
  platform=$(terraform -chdir=terraform/platform output -json)
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
expect PARSE_QUEUE_URL "$(env_value PARSE_QUEUE_URL)" "$(out "$v2" parse_queue_url)"
expect INVOICE_PARSE_QUEUE_URL "$(env_value INVOICE_PARSE_QUEUE_URL)" "$(out "$v2" invoice_parse_queue_url)"
expect COGNITO_USER_POOL_ID "$(env_value COGNITO_USER_POOL_ID)" "$(out "$v2" cognito_user_pool_id)"

expect "Ingress certificate-arn" \
  "$(yq -r '.metadata.annotations["alb.ingress.kubernetes.io/certificate-arn"]' "$OVERLAY/ingress.yaml")" \
  "$(out "$v2" api_certificate_arn)"
expect "images newName" \
  "$(yq -r '.images[] | select(.name == "cashight-backend") | .newName' "$OVERLAY/kustomization.yaml")" \
  "$(out "$v2" ecr_repository_url)"

for pair in parse-queue:parse invoice-parse-queue:invoice_parse; do
  auth=${pair%%:*} key=${pair#*:}
  expect "TriggerAuthentication roleArn ($auth)" \
    "$(yq -r "select(.kind == \"TriggerAuthentication\" and .metadata.name == \"$auth\") | .spec.podIdentity.roleArn" "$OVERLAY/scaling.yaml")" \
    "$(jq -r --arg k "$key" '.keda_scaler_role_arns.value[$k] // empty' <<<"$platform")"
done

for pair in parser-worker:PARSE_QUEUE_URL invoice-parser-worker:INVOICE_PARSE_QUEUE_URL; do
  name=${pair%%:*} key=${pair#*:}
  expect "ScaledObject queueURL ($name)" \
    "$(yq -r "select(.kind == \"ScaledObject\" and .metadata.name == \"$name\") | .spec.triggers[0].metadata.queueURL" "$OVERLAY/scaling.yaml")" \
    "$(env_value "$key")"
done

expect "Application repoURL" "$(yq -r '.spec.source.repoURL' "$APPLICATION")" "$(out "$platform" gitops_repo_url)"

if [ "$failures" -gt 0 ]; then
  echo "check-overlay: $failures value(s) differ from Terraform" >&2
  exit 1
fi
echo "check-overlay: PASS"
