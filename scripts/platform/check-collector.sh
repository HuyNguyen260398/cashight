#!/usr/bin/env bash
# OpenTelemetry Collector add-on acceptance, without a cluster.
#
# Renders deploy/platform/config/addons/opentelemetry-collector.yaml through
# scripts/platform/render-collector.sh, then asserts on the rendered manifests (the
# workload shape: namespace, RBAC, pod, token delivery) and on the collector
# config (pipeline, allowlist, exporter), and runs `otelcol-contrib validate`
# on the cluster and local configs. Exits 1 on any FAIL.
#
# Component names are the collector's current ones (file_log, k8s_attributes,
# otlp_http); the chart rewrites the deprecated spellings to these anyway.
#
# Needs helm, kubectl, yq (mikefarah v4), kubeconform, openssl and Docker.
# Run: bash scripts/platform/check-collector.sh
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT
./scripts/platform/render-collector.sh "$out" >/dev/null
manifests="$out/manifests.yaml"

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
q() { yq ea "$1" "$manifests"; }

ds='select(.kind == "DaemonSet")'
pod="$ds | .spec.template.spec"
collector="$pod | .containers[] | select(.name == \"opentelemetry-collector\")"
init="$pod | .initContainers[] | select(.name == \"fetch-grafana-cloud\")"

# ------------------------------------------------------------------ workload ---

# The chart suffixes the DaemonSet with -agent; the Service keeps the
# fullnameOverride, otel-collector, which is the name workloads use.
assert_eq "One DaemonSet otel-collector-agent in observability" \
  "$(q '[select(.kind == "DaemonSet" and .metadata.name == "otel-collector-agent" and .metadata.namespace == "observability")] | length')" 1
assert_eq "No Deployment or StatefulSet" "$(q '[select(.kind == "Deployment" or .kind == "StatefulSet")] | length')" 0
assert_eq "No Secret rendered" "$(q '[select(.kind == "Secret")] | length')" 0
assert_eq "Service exposes only 4318" \
  "$(q 'select(.kind == "Service" and .metadata.name == "otel-collector") | [.spec.ports[].port] | join(",")')" 4318
# A hostPort would publish OTLP on the node's public IP.
assert_eq "No hostPort" "$(q '[.. | select(tag == "!!map" and has("hostPort"))] | length')" 0

image="$(q "$collector | .image")"
if [[ "$image" =~ ^otel/opentelemetry-collector-contrib:[0-9][0-9.]*$ ]]; then
  pass "Image is pinned contrib ($image)"
else
  fail_line "Image is pinned contrib (got '$image')"
fi

assert_eq "Resources" \
  "$(q "$collector | [.resources.requests.cpu, .resources.requests.memory, .resources.limits.memory] | join(\",\")")" \
  "100m,128Mi,256Mi"

assert_empty "Hardened containers" "$(q "$pod | (.containers + .initContainers)[] |
  select(.securityContext.runAsUser != 0
    or .securityContext.readOnlyRootFilesystem != true
    or .securityContext.allowPrivilegeEscalation != false
    or ((.securityContext.capabilities.drop // []) | join(\",\")) != \"ALL\") | .name")"

assert_eq "hostPath is only /var/log/pods" \
  "$(q "$pod | [.volumes[] | select(.hostPath) | .hostPath.path] | join(\",\")")" /var/log/pods
assert_empty "hostPath mounts are read-only" "$(q "$pod | [.volumes[] | select(.hostPath) | .name] as \$hp |
  (.containers + .initContainers)[] | .name as \$c | .volumeMounts[] |
  select((.name as \$n | \$hp | contains([\$n])) and .readOnly != true) | \$c + \"/\" + .name")"

assert_eq "Secrets volume is in memory" \
  "$(q "$pod | .volumes[] | select(.name == \"secrets\") | .emptyDir.medium")" Memory
assert_eq "Init mounts /secrets read-write" \
  "$(q "$init | .volumeMounts[] | select(.name == \"secrets\") | .mountPath + \",\" + ((.readOnly // false) | tostring)")" \
  "/secrets,false"
assert_eq "Collector mounts /secrets read-only" \
  "$(q "$collector | .volumeMounts[] | select(.name == \"secrets\") | .mountPath + \",\" + ((.readOnly // false) | tostring)")" \
  "/secrets,true"

init_image="$(q "$init | .image")"
if [[ "$init_image" =~ ^public\.ecr\.aws/aws-cli/aws-cli:[0-9][0-9.]*$ ]]; then
  pass "Init image is pinned AWS CLI ($init_image)"
else
  fail_line "Init image is pinned AWS CLI (got '$init_image')"
fi
init_command="$(q "$init | (.command + (.args // [])) | join(\" \")")"
missing=""
for needle in otlp-token otlp-endpoint instance-id "test -s"; do
  [[ "$init_command" == *"$needle"* ]] || missing="$missing $needle"
done
assert_empty "Init fetches and checks every parameter" "${missing# }"
# SSM rejects any name whose first path segment starts with aws or ssm.
init_prefix="$(q "$init | .env[] | select(.name == \"PREFIX\") | .value")"
if tr '[:upper:]' '[:lower:]' <<<"$init_prefix" | grep -qE '^/?(aws|ssm)'; then
  fail_line "SSM prefix is not reserved (got '$init_prefix')"
else
  pass "SSM prefix is not reserved ($init_prefix)"
fi
# The init container must read the path terraform/platform hands the cluster
# Secret (grafana_cloud_parameter_path), not the retired /platform/... prefix.
assert_eq "Init reads /cashight/grafana-cloud" "$init_prefix" "/cashight/grafana-cloud"

# ---------------------------------------------------------------------- RBAC ---

assert_eq "ClusterRole verbs are read-only" \
  "$(q '[select(.kind == "ClusterRole") | .rules[].verbs[]] | unique | sort | join(",")')" "get,list,watch"
assert_eq "ClusterRole resources" \
  "$(q '[select(.kind == "ClusterRole") | .rules[].resources[]] | unique | sort | join(",")')" \
  "daemonsets,deployments,jobs,namespaces,nodes,nodes/stats,pods,replicasets,statefulsets"
assert_eq "Lease Role in observability" \
  "$(q 'select(.kind == "Role" and .metadata.namespace == "observability") | .rules[] | (.apiGroups | join(",")) + ";" + (.resources | join(",")) + ";" + (.verbs | sort | join(","))')" \
  "coordination.k8s.io;leases;create,get,list,patch,update,watch"
assert_eq "Lease Role bound to otel-collector" \
  "$(q 'select(.kind == "RoleBinding" and .metadata.namespace == "observability") | .subjects[] | .kind + "/" + .namespace + "/" + .name')" \
  "ServiceAccount/observability/otel-collector"

# ----------------------------------------------------------------- namespace ---

assert_eq "Namespace observability is privileged" \
  "$(q 'select(.kind == "Namespace" and .metadata.name == "observability") | .metadata.labels | [.["pod-security.kubernetes.io/enforce"], .["pod-security.kubernetes.io/audit"], .["pod-security.kubernetes.io/warn"]] | join(",")')" \
  "privileged,privileged,privileged"
assert_eq "No NetworkPolicy" "$(q '[select(.kind == "NetworkPolicy")] | length')" 0

if kubeconform -strict -summary -ignore-missing-schemas "$manifests" >/dev/null; then
  pass "kubeconform"
else
  fail_line "kubeconform"
fi

# -------------------------------------------------------------------- config ---

config="$out/config.yaml"
local_config="$out/config-local.yaml"
cq() { yq "$1" "$config"; }

assert_eq "Receivers" "$(cq '.receivers | keys | sort | join(",")')" "file_log,k8s_cluster,kubeletstats,otlp,prometheus"
assert_eq "OTLP HTTP only" "$(cq '.receivers.otlp.protocols | keys | join(",")')" http
if [[ "$(cq '.receivers.otlp.protocols.http.endpoint')" == *:4318 ]]; then pass "OTLP on 4318"; else fail_line "OTLP on 4318"; fi
assert_eq "file_log reads pod logs" "$(cq '.receivers.file_log.include | join(",")')" "/var/log/pods/*/*/*.log"
assert_eq "file_log excludes the collector" \
  "$(cq '.receivers.file_log.exclude | contains(["/var/log/pods/observability_otel-collector*_*/*/*.log"])')" true
assert_eq "k8s_cluster is leader-elected" \
  "$(cq '.receivers.k8s_cluster.k8s_leader_elector + "," + (.service.extensions | contains(["k8s_leader_elector"]) | tostring)')" \
  "k8s_leader_elector,true"
assert_eq "Self-scrape keeps process metrics only" \
  "$(cq '[.receivers.prometheus.config.scrape_configs[].metric_relabel_configs[] | .action + ":" + .regex] | join(",")')" \
  "keep:otelcol_process_.*"
assert_empty "Processor order" "$(cq '.service.pipelines | to_entries[] |
  select((.value.processors | join(",")) != "memory_limiter,k8s_attributes,transform/allowlist,batch") | .key')"
limit="$(cq '.processors.memory_limiter.limit_mib + .processors.memory_limiter.spike_limit_mib')"
if [ "$limit" -lt 256 ]; then pass "memory_limiter under the 256Mi limit ($limit MiB)"; else fail_line "memory_limiter under the 256Mi limit (got $limit MiB)"; fi
assert_eq "memory_limiter uses fixed MiB" \
  "$(cq '.processors.memory_limiter | has("limit_percentage") or has("spike_limit_percentage")')" false
assert_eq "k8s_attributes minimal" \
  "$(cq '.processors.k8s_attributes.extract | (.metadata | join(",")) + ";" + ((.labels // []) | length | tostring) + ";" + ((.annotations // []) | length | tostring)')" \
  "k8s.namespace.name,k8s.pod.name,k8s.container.name,k8s.node.name;0;0"
assert_empty "One exporter per pipeline" "$(cq '.service.pipelines | to_entries[] | select((.value.exporters | join(",")) != "otlp_http") | .key')"
assert_eq "Exporters" "$(cq '.exporters | keys | join(",")')" otlp_http
# shellcheck disable=SC2016 # the ${file:...} references are literal collector config
assert_eq "Exporter auth" \
  "$(cq '.exporters.otlp_http.endpoint + ";" + .exporters.otlp_http.auth.authenticator + ";" + .extensions["basicauth/grafana"].client_auth.username + ";" + .extensions["basicauth/grafana"].client_auth.password')" \
  '${file:/secrets/otlp-endpoint};basicauth/grafana;${file:/secrets/instance-id};${file:/secrets/otlp-token}'
assert_eq "Logs come from file_log only" "$(cq '.service.pipelines.logs.receivers | join(",")')" file_log
assert_eq "Metrics receivers" "$(cq '.service.pipelines.metrics.receivers | sort | join(",")')" "k8s_cluster,kubeletstats,otlp,prometheus"
assert_eq "Traces receivers" "$(cq '.service.pipelines.traces.receivers | join(",")')" otlp
if grep -qE 'glc_|eyJ' "$config"; then fail_line "No inline credentials"; else pass "No inline credentials"; fi

# The local variant differs only by the Kubernetes components and the local
# file exporter and log labels (scripts/platform/run-local-collector.sh).
lq() { yq "$1" "$local_config"; }
assert_eq "Local receivers" "$(lq '.receivers | keys | sort | join(",")')" "file_log,otlp,prometheus"
assert_eq "Local processors" \
  "$(lq '[.service.pipelines | to_entries[] | .key + "=" + (.value.processors | join(","))] | sort | join(" ")')" \
  "logs=memory_limiter,transform/allowlist,transform/local,batch metrics=memory_limiter,transform/allowlist,batch traces=memory_limiter,transform/allowlist,batch"
assert_eq "Local exporters" \
  "$(lq '[.service.pipelines[] | .exporters | join(",")] | unique | join(" ")')" "otlp_http,file/local"
assert_eq "Local reads /var/log/local" "$(lq '.receivers.file_log.include | join(",")')" "/var/log/local/*.log"
assert_eq "Local has no k8s extension" "$(lq '.service.extensions | contains(["k8s_leader_elector"])')" false

# ------------------------------------------------------------------ validate ---

collector_image="$image"
fixtures="$out/fixtures"
mkdir -p "$fixtures/secrets" "$fixtures/serviceaccount"
# The secrets come from the init container's own script, run against a stub
# aws that, like the real CLI's text output, ends each value with a newline.
# ${file:...} keeps that newline, which makes the endpoint an invalid URL.
mkdir -p "$fixtures/bin"
cat >"$fixtures/bin/aws" <<'STUB'
#!/bin/sh
case "$*" in
  *otlp-token*) echo dummy-token ;;
  *otlp-endpoint*) echo https://otlp.example.invalid/otlp ;;
  *instance-id*) echo 123456 ;;
  *) exit 1 ;;
esac
STUB
chmod +x "$fixtures/bin/aws"
init_script="$(q "$init | .args[0]")"
PATH="$fixtures/bin:$PATH" PREFIX=/check sh -ec "${init_script//\/secrets\//$fixtures/secrets/}"
# In-cluster client config only reads these files at build time; nothing
# connects. A real PEM is needed because the CA file is parsed.
printf 'dummy' >"$fixtures/serviceaccount/token"
printf 'observability' >"$fixtures/serviceaccount/namespace"
openssl req -x509 -nodes -newkey rsa:2048 -days 1 -subj /CN=collector-check \
  -keyout "$fixtures/serviceaccount/ca.key" -out "$fixtures/serviceaccount/ca.crt" >/dev/null 2>&1
chmod -R a+rX "$out"

for file in config.yaml config-local.yaml; do
  if docker run --rm \
    -e MY_POD_IP=0.0.0.0 -e OTEL_K8S_NODE_NAME=collector-check \
    -e KUBERNETES_SERVICE_HOST=127.0.0.1 -e KUBERNETES_SERVICE_PORT=6443 \
    -v "$out:/cfg:ro" -v "$fixtures/secrets:/secrets:ro" \
    -v "$fixtures/serviceaccount:/var/run/secrets/kubernetes.io/serviceaccount:ro" \
    "$collector_image" validate --config="/cfg/$file" >"$out/validate-$file.log" 2>&1; then
    pass "otelcol-contrib validate $file"
  else
    fail_line "otelcol-contrib validate $file ($(tail -n 3 "$out/validate-$file.log" | tr '\n' ' '))"
  fi
done

exit "$fail"
