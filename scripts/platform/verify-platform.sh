#!/usr/bin/env bash
# Platform acceptance. See docs/platform.md, Bring-up.
#
# Three groups of assertions:
#
#   Platform invariants  always checked. Cluster, node group and node, EKS
#                        add-ons, no Fargate, the collector's Grafana Cloud
#                        parameters present.
#   GitOps               only when enable_argocd is on: the Argo CD capability,
#                        the add-ons it installs (load balancer controller,
#                        cert-manager, Argo Rollouts, KEDA, the
#                        OpenTelemetry Collector), Applications
#                        converged, tenant namespaces guarded.
#   Workloads            with GitOps on. Greenfield by default - no workload
#                        Pods, no Ingress, no LoadBalancer Service. Set
#                        EXPECT_WORKLOADS=true once Cashight is deployed; the
#                        non-goals are then replaced by namespace-contract
#                        checks.
#
# EXPECTED_NODES is the node group size (default 2). WORKLOAD_NAMESPACES lists
# the tenant namespaces declared in deploy/platform/config/namespaces/values.yaml
# (default "cashight").
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

cluster="${CLUSTER_NAME:-$(terraform -chdir=terraform/platform output -raw cluster_name)}"
region="${AWS_REGION:-$(aws configure get region)}"
grafana_cloud_parameter_path="${GRAFANA_CLOUD_PARAMETER_PATH:-$(terraform -chdir=terraform/platform output -raw grafana_cloud_parameter_path)}"
argocd_enabled="${ARGOCD_ENABLED:-$(terraform -chdir=terraform/platform output -raw argocd_enabled)}"
EXPECT_WORKLOADS="${EXPECT_WORKLOADS:-false}"
EXPECTED_NODES="${EXPECTED_NODES:-2}"
read -r -a workload_namespaces <<<"${WORKLOAD_NAMESPACES:-cashight}"
nodegroup="${cluster}-general"

fail=0
pass() { echo "PASS $1"; }
fail_line() {
  echo "FAIL $1"
  fail=1
}
assert_eq() {
  if [ "$2" = "$3" ]; then pass "$1"; else fail_line "$1 (got '$2', want '$3')"; fi
}
# $2 is a newline-separated list that must be empty; offenders are named.
assert_empty() {
  if [ -z "$2" ]; then pass "$1"; else fail_line "$1 ($(echo "$2" | tr '\n' ' '))"; fi
}

# ---------------------------------------------------------------- platform ---

connection="$(terraform -chdir=terraform/platform-base output -raw github_connection_arn)"
assert_eq "CodeConnections AVAILABLE" "$(aws codeconnections get-connection --connection-arn "$connection" --query 'Connection.ConnectionStatus' --output text)" AVAILABLE
assert_eq "EKS ACTIVE" "$(aws eks describe-cluster --name "$cluster" --region "$region" --query 'cluster.status' --output text)" ACTIVE
assert_eq "No Fargate profiles" "$(aws eks list-fargate-profiles --cluster-name "$cluster" --region "$region" --query 'length(fargateProfileNames)' --output text)" 0

# --- Capacity: exactly the general node group, Graviton.
assert_eq "Node group ${nodegroup} ACTIVE" "$(aws eks describe-nodegroup --cluster-name "$cluster" --nodegroup-name "$nodegroup" --region "$region" --query 'nodegroup.status' --output text)" ACTIVE
nodes="$(kubectl get nodes -o json | jq '.items')"
assert_eq "Nodes Ready" "$(jq '[.[] | select(any(.status.conditions[]; .type == "Ready" and .status == "True"))] | length' <<<"$nodes")" "$EXPECTED_NODES"
assert_empty "Nodes are arm64 members of ${nodegroup}" "$(jq -r --arg ng "$nodegroup" '.[] | select(.metadata.labels["kubernetes.io/arch"] != "arm64" or .metadata.labels["eks.amazonaws.com/nodegroup"] != $ng) | .metadata.name' <<<"$nodes")"
# Prefix delegation only helps if the kubelet ceiling was raised with it; a
# small instance otherwise stops scheduling at 17 Pods.
assert_empty "Nodes allow 110 Pods" "$(jq -r '.[] | select(.status.capacity.pods != "110") | "\(.metadata.name)=\(.status.capacity.pods)"' <<<"$nodes")"

# --- EKS add-ons. Without enableNetworkPolicy the VPC CNI accepts
# NetworkPolicy objects and silently enforces none of them.
for addon in vpc-cni kube-proxy eks-pod-identity-agent coredns; do
  assert_eq "Add-on ${addon} ACTIVE" "$(aws eks describe-addon --cluster-name "$cluster" --addon-name "$addon" --region "$region" --query 'addon.status' --output text)" ACTIVE
done
cni_config="$(aws eks describe-addon --cluster-name "$cluster" --addon-name vpc-cni --region "$region" --query 'addon.configurationValues' --output text)"
assert_eq "VPC CNI enforces NetworkPolicy" "$(jq -r '.enableNetworkPolicy // "unset"' <<<"$cni_config")" true
assert_eq "VPC CNI uses prefix delegation" "$(jq -r '.env.ENABLE_PREFIX_DELEGATION // "unset"' <<<"$cni_config")" true
if kubectl -n kube-system rollout status deployment/coredns --timeout=5m >/dev/null; then pass "Deployment kube-system/coredns"; else fail_line "Deployment kube-system/coredns"; fi

# --- The collector's init container reads these (created by hand, see
# docs/observability.md). Only existence is checked; values are never fetched.
for parameter in otlp-token otlp-endpoint instance-id; do
  name="$(aws ssm get-parameter --name "${grafana_cloud_parameter_path}/${parameter}" --region "$region" --query 'Parameter.Name' --output text 2>/dev/null || true)"
  if [ -n "$name" ] && [ "$name" != None ]; then pass "SSM ${grafana_cloud_parameter_path}/${parameter}"; else fail_line "SSM ${grafana_cloud_parameter_path}/${parameter}"; fi
done
# --- The collector's role binds by namespace and ServiceAccount name; the
# association exists before Argo CD creates either.
assert_eq "Pod Identity association observability/otel-collector" "$(aws eks list-pod-identity-associations --cluster-name "$cluster" --namespace observability --service-account otel-collector --region "$region" --query 'length(associations)' --output text)" 1

if [ "$argocd_enabled" != true ]; then
  echo "SKIP GitOps and workload checks (enable_argocd = false)"
  exit "$fail"
fi

# ------------------------------------------------------------------ gitops ---

assert_eq "argocd capability ACTIVE" "$(aws eks describe-capability --cluster-name "$cluster" --capability-name "${cluster}-argocd" --region "$region" --query 'capability.status' --output text)" ACTIVE
for deployment in 'kube-system aws-load-balancer-controller' 'argo-rollouts argo-rollouts' 'cert-manager cert-manager' 'cert-manager cert-manager-webhook' 'keda keda-operator' 'keda keda-operator-metrics-apiserver' 'keda keda-admission-webhooks'; do
  read -r ns name <<<"$deployment"
  if kubectl -n "$ns" rollout status deployment/"$name" --timeout=5m >/dev/null; then
    pass "Deployment $ns/$name"
  else
    fail_line "Deployment $ns/$name"
  fi
done

# --- Telemetry: the collector DaemonSet (the chart suffixes it -agent) runs on
# every node, reads its tokens from SSM (no Secret), and may mount hostPath.
collector_ds="$(kubectl -n observability get daemonset otel-collector-agent -o json 2>/dev/null || echo '{}')"
if jq -e '(.status.desiredNumberScheduled // 0) >= 1 and .status.numberReady == .status.desiredNumberScheduled' <<<"$collector_ds" >/dev/null; then
  pass "DaemonSet observability/otel-collector-agent ready"
else
  fail_line "DaemonSet observability/otel-collector-agent ready ($(jq -r '"\(.status.numberReady // 0)/\(.status.desiredNumberScheduled // 0)"' <<<"$collector_ds"))"
fi
assert_eq "No Secrets in observability" "$(kubectl -n observability get secrets -o json 2>/dev/null | jq '[.items[] | select(.type != "kubernetes.io/service-account-token")] | length')" 0
assert_eq "Namespace observability is privileged" "$(kubectl get namespace observability -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || true)" privileged

assert_eq "KEDA external metrics APIService Available" "$(kubectl get apiservice v1beta1.external.metrics.k8s.io -o jsonpath='{.status.conditions[?(@.type=="Available")].status}')" True

# `all` on an empty array is vacuously true, so an empty argocd namespace used to
# pass this. Require at least one Application as well.
apps_json="$(kubectl -n argocd get applications -o json)"
app_count="$(printf '%s' "$apps_json" | jq '.items | length')"
if [ "$app_count" = 0 ]; then
  fail_line "Argo Applications Synced Healthy (none exist)"
elif printf '%s' "$apps_json" | jq -e '.items | all(.status.sync.status == "Synced" and .status.health.status == "Healthy")' >/dev/null; then
  pass "Argo Applications Synced Healthy ($app_count)"
else
  fail_line "Argo Applications Synced Healthy"
  printf '%s' "$apps_json" | jq -r '
    .items[]
    | select((.status.sync.status != "Synced") or (.status.health.status != "Healthy"))
    | "    \(.metadata.name): \(.status.sync.status // "?")/\(.status.health.status // "?")"
  '
fi

# --- Tenant namespaces: restricted Pod Security, default-deny, a quota.
for ns in "${workload_namespaces[@]}"; do
  assert_eq "Namespace ${ns} enforces restricted Pod Security" "$(kubectl get namespace "$ns" -o jsonpath='{.metadata.labels.pod-security\.kubernetes\.io/enforce}' 2>/dev/null || true)" restricted
  policies=" $(kubectl -n "$ns" get networkpolicy -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || true) "
  for policy in tenant-ingress-deny-all tenant-egress-deny-all tenant-egress-allow-dns; do
    if [[ "$policies" == *" ${policy} "* ]]; then pass "NetworkPolicy ${ns}/${policy}"; else fail_line "NetworkPolicy ${ns}/${policy}"; fi
  done
  assert_eq "ResourceQuota in ${ns}" "$(kubectl -n "$ns" get resourcequota -o json 2>/dev/null | jq '.items | length')" 1
done

# --------------------------------------------------------------- workloads ---

# Namespaces the platform itself runs in.
platform_namespaces='^(kube-system|argo-rollouts|cert-manager|keda|observability|argocd|kube-public|kube-node-lease|default)$'
tenants_json="$(printf '%s\n' "${workload_namespaces[@]}" | jq -R . | jq -s .)"
# A workload Pod lives in an apps-* namespace or a tenant namespace.
workload_filter="(.metadata.namespace | startswith(\"apps-\")) or (.metadata.namespace as \$ns | \$tenants | index(\$ns) != null)"

if [ "$EXPECT_WORKLOADS" = true ]; then
  # Workloads are allowed. Assert they respect the namespace contract and are
  # actually running, rather than asserting they do not exist.
  stray="$(
    kubectl get pods -A -o json |
      jq -r --arg re "$platform_namespaces" --argjson tenants "$tenants_json" "
        .items[]
        | select((.metadata.namespace | test(\$re)) | not)
        | select(($workload_filter) | not)
        | \"\(.metadata.namespace)/\(.metadata.name)\"
      "
  )"
  assert_empty "Workload Pods confined to apps-* and tenant namespaces" "$stray"

  unhealthy="$(
    kubectl get pods -A -o json |
      jq -r --argjson tenants "$tenants_json" "
        .items[]
        | select($workload_filter)
        | select(.status.phase != \"Running\" and .status.phase != \"Succeeded\")
        | \"\(.metadata.namespace)/\(.metadata.name) \(.status.phase)\"
      "
  )"
  assert_empty "Workload Pods Running" "$unhealthy"

  # Every Ingress must have been reconciled into a load balancer address.
  pending="$(
    kubectl get ingress -A -o json |
      jq -r '.items[] | select((.status.loadBalancer.ingress // []) | length == 0) | "\(.metadata.namespace)/\(.metadata.name)"'
  )"
  assert_empty "Ingresses have load balancer addresses" "$pending"
else
  # Greenfield non-goals: nothing is hosted yet.
  assert_eq "No service workloads" "$(kubectl get pods -A -o json | jq --argjson tenants "$tenants_json" "[.items[] | select($workload_filter)] | length")" 0
  assert_eq "No Ingress" "$(kubectl get ingress -A -o json | jq '.items | length')" 0
  assert_eq "No LoadBalancer Service" "$(kubectl get svc -A -o json | jq '[.items[] | select(.spec.type == "LoadBalancer")] | length')" 0
fi

exit "$fail"
