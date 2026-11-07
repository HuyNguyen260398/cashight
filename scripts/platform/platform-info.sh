#!/usr/bin/env bash
# Report what is deployed and where to reach it. Read-only: mutates nothing.
#
# scripts/platform/verify-platform.sh is the acceptance gate. This is the "what did I
# just deploy" report, so it exits 0 even when nothing is deployed - a partly
# deployed platform must still produce a useful report rather than an error.
#
# `set -e` is deliberately absent. Every lookup here is allowed to fail: the
# cluster, the CodeConnections connection, the ALB and the workload Ingresses
# each come into existence at a different stage, and the whole point of this
# script is to report which of them exist yet.
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 0

root="terraform/platform"

tf_output() {
  terraform -chdir="$root" output -raw "$1" 2>/dev/null || true
}

field() {
  printf '  %-14s %s\n' "$1" "$2"
}

cluster="${CLUSTER_NAME:-$(tf_output cluster_name)}"
region="${AWS_REGION:-$(aws configure get region 2>/dev/null)}"
account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"

if [ -z "$cluster" ]; then
  echo "Nothing deployed: no cluster_name output in $root."
  echo "Run the platform apply first - see docs/platform.md, Bring-up."
  exit 0
fi

status="$(aws eks describe-cluster --name "$cluster" --region "$region" \
  --query 'cluster.status' --output text 2>/dev/null)"

echo
echo "Cluster"
field Name "$cluster"
field Status "${status:-not found}"
field Region "${region:-unknown}"
field Account "${account:-unknown}"
field Endpoint "$(tf_output cluster_endpoint)"

connection_arn="$(terraform -chdir=terraform/platform-base output -raw github_connection_arn 2>/dev/null || true)"
connection_status=""
if [ -n "$connection_arn" ]; then
  connection_status="$(aws codeconnections get-connection \
    --connection-arn "$connection_arn" \
    --query 'Connection.ConnectionStatus' --output text 2>/dev/null)"
fi

echo
echo "GitOps"
field Repository "$(tf_output gitops_repo_url)"
field Connection "${connection_status:-unknown}"

# The ALB is created by aws-load-balancer-controller once Argo CD syncs an
# Ingress into the platform-public group, so its absence is a normal early
# state rather than a fault.
alb="$(aws elbv2 describe-load-balancers --names platform-public \
  --region "$region" --query 'LoadBalancers[0].[DNSName,State.Code]' \
  --output text 2>/dev/null)"
alb_dns=""
alb_state=""
read -r alb_dns alb_state <<<"$alb"

echo
echo "Public ALB"
if [ -z "$alb_dns" ] || [ "$alb_dns" = None ]; then
  field Status "none yet (no Ingress reconciled into platform-public)"
else
  field DNS "$alb_dns"
  field State "${alb_state:-unknown}"
fi

echo
echo "Workloads"
rows=""
ingress_json="$(kubectl get ingress -A -o json 2>/dev/null)"
if [ -n "$ingress_json" ]; then
  rows="$(printf '%s' "$ingress_json" | jq -r '
    .items[]
    | select(.metadata.namespace | test("^(kube-system|argocd|keda|cert-manager|argo-rollouts)$") | not)
    | . as $i
    | ((($i.status.loadBalancer.ingress // []) | map(.hostname // .ip))[0]) as $addr
    | $i.spec.rules[]?.http.paths[]?
    | "\($i.metadata.namespace)\thttp://\($addr // "<pending>")\(.path)"
  ' 2>/dev/null)"
fi

if [ -z "$rows" ]; then
  echo "  no workload Ingress yet"
else
  printf '%s\n' "$rows" | while IFS="$(printf '\t')" read -r ns url; do
    field "$ns" "$url"
  done
fi

echo
