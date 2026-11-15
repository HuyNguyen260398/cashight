#!/usr/bin/env bash
# Guards deploy/cashight/overlays/v2-minimal (docs/v2-minimal.md) before it
# reaches the cluster:
#   - schema (kubeconform, built-in schemas only: the overlay has no CRDs);
#   - exactly the five kinds v2 minimal runs, nothing from the full platform;
#   - the Deployment's rollout shape, merged entrypoint, Fargate sizing, probes,
#     revision env and per-release app-version annotation;
#   - Pod Security "restricted" container settings and a /tmp emptyDir;
#   - the image pinned by digest, the IRSA role, the AI-summary-off config,
#     and the single-path Ingress.
# Exit 1 with one FAIL line per problem.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

OVERLAY=${OVERLAY:-deploy/cashight/overlays/v2-minimal}

failures=0
fail() {
  echo "FAIL: $*" >&2
  failures=$((failures + 1))
}

if [ ! -d "$OVERLAY" ]; then
  echo "FAIL: $OVERLAY not found" >&2
  exit 1
fi

rendered=$(mktemp)
trap 'rm -f "$rendered"' EXIT
kubectl kustomize "$OVERLAY" >"$rendered"

# Read from stdin: kubeconform skips a file argument without a .yaml suffix.
kubeconform -strict -summary <"$rendered" || fail "kubeconform"

docs=$(yq -o=json -I=0 '.' "$rendered" | jq -s '.')

# check <description> <jq expression that must print true>
check() {
  local description=$1 expression=$2
  [ "$(jq -r "$expression" <<<"$docs")" = "true" ] || fail "$description"
}

check "kinds are exactly ServiceAccount, ConfigMap, Deployment, Service, Ingress" \
  '(map(.kind) | sort) == ["ConfigMap", "Deployment", "Ingress", "Service", "ServiceAccount"]'
check "every object is in namespace cashight" \
  'all(.[]; .metadata.namespace == "cashight")'

deployment='(map(select(.kind == "Deployment" and .metadata.name == "cashight-api")) | first)'
pod="$deployment.spec.template.spec"
app="($pod.containers | map(select(.name == \"app\")) | first)"

check "Deployment cashight-api exists" "$deployment != null"
check "Deployment has replicas: 1" "$deployment.spec.replicas == 1"
check "rolling update is maxSurge 1, maxUnavailable 0" \
  "$deployment.spec.strategy.type == \"RollingUpdate\" and $deployment.spec.strategy.rollingUpdate == {\"maxSurge\": 1, \"maxUnavailable\": 0}"
check "revisionHistoryLimit is 3" "$deployment.spec.revisionHistoryLimit == 3"
check "pod template carries the cashight.nghuy.link/app-version annotation" \
  "($deployment.spec.template.metadata.annotations[\"cashight.nghuy.link/app-version\"] // \"\") != \"\""
check "container runs the merged entrypoint /app/api-all/index.js" \
  "$app.args == [\"/app/api-all/index.js\"]"
check "requests are cpu 250m, memory 256Mi" \
  "$app.resources.requests == {\"cpu\": \"250m\", \"memory\": \"256Mi\"}"
check "limits are cpu 250m, memory 256Mi" \
  "$app.resources.limits == {\"cpu\": \"250m\", \"memory\": \"256Mi\"}"
check "liveness probe is /healthz" "$app.livenessProbe.httpGet.path == \"/healthz\""
check "readiness probe is /readyz" "$app.readinessProbe.httpGet.path == \"/readyz\""
check "POD_TEMPLATE_HASH comes from the pod-template-hash label" \
  "($app.env // [] | map(select(.name == \"POD_TEMPLATE_HASH\")) | first | .valueFrom.fieldRef.fieldPath) == \"metadata.labels['pod-template-hash']\""
check "the ServiceAccount token is mounted (IRSA needs it)" \
  "$pod.automountServiceAccountToken == true and $pod.serviceAccountName == \"cashight-api\""

# Pod Security "restricted".
check "pod runAsNonRoot" "$pod.securityContext.runAsNonRoot == true"
check "pod seccomp RuntimeDefault" "$pod.securityContext.seccompProfile.type == \"RuntimeDefault\""
check "container runAsNonRoot" "$app.securityContext.runAsNonRoot == true"
check "container allowPrivilegeEscalation false" "$app.securityContext.allowPrivilegeEscalation == false"
check "container readOnlyRootFilesystem" "$app.securityContext.readOnlyRootFilesystem == true"
check "container drops ALL capabilities" "$app.securityContext.capabilities.drop == [\"ALL\"]"
check "container seccomp RuntimeDefault" "$app.securityContext.seccompProfile.type == \"RuntimeDefault\""
check "/tmp is an emptyDir" \
  "($app.volumeMounts | map(select(.mountPath == \"/tmp\")) | first | .name) as \$v | ($pod.volumes | map(select(.name == \$v)) | first | has(\"emptyDir\"))"
check "image is pinned by digest" "$app.image | test(\"@sha256:[0-9a-f]{64}$\")"

check "ServiceAccount cashight-api carries the cashight-v2-min-api IRSA role" \
  '(map(select(.kind == "ServiceAccount" and .metadata.name == "cashight-api")) | first | .metadata.annotations["eks.amazonaws.com/role-arn"] // "") | test("^arn:aws:iam::[0-9]{12}:role/cashight-v2-min-api$")'

# The committed name is cashight-env; a release renames it to
# cashight-env-<sha12> (scripts/v2-minimal/version-release.sh).
env='(map(select(.kind == "ConfigMap" and (.metadata.name | test("^cashight-env(-[0-9a-f]{12})?$")))) | first | .data)'
check "the Deployment's envFrom names the overlay's ConfigMap" \
  "(map(select(.kind == \"ConfigMap\")) | map(.metadata.name)) as \$cms | ($app.envFrom | map(.configMapRef.name) | all(. as \$n | \$cms | index(\$n)))"
check "ConfigMap cashight-env sets AI_SUMMARY_ENABLED: \"false\"" "$env.AI_SUMMARY_ENABLED == \"false\""
for key in GEMINI_PARAM OTEL_EXPORTER_OTLP_ENDPOINT PARSE_QUEUE_URL INVOICE_PARSE_QUEUE_URL; do
  check "ConfigMap cashight-env must not set $key" "$env | has(\"$key\") | not"
done
check "ConfigMap cashight-env sets EXPORT_BUCKET" "($env.EXPORT_BUCKET // \"\") != \"\""
check "ConfigMap cashight-env sets APP_VERSION" "($env.APP_VERSION // \"\") != \"\""

ingress='(map(select(.kind == "Ingress" and .metadata.name == "cashight")) | first)'
annotation() { echo "($ingress.metadata.annotations[\"alb.ingress.kubernetes.io/$1\"] // \"\")"; }
check "Ingress has a single rule for api.cashight-v2.nghuy.link" \
  "($ingress.spec.rules | length) == 1 and $ingress.spec.rules[0].host == \"api.cashight-v2.nghuy.link\""
check "Ingress has a single path / to cashight-api" \
  "$ingress.spec.rules[0].http.paths == [{\"path\": \"/\", \"pathType\": \"Prefix\", \"backend\": {\"service\": {\"name\": \"cashight-api\", \"port\": {\"name\": \"http\"}}}}]"
check "Ingress target-type is ip" "$(annotation target-type) == \"ip\""
check "Ingress scheme is internet-facing" "$(annotation scheme) == \"internet-facing\""
check "Ingress group is cashight" "$(annotation group.name) == \"cashight\""
check "Ingress health check is /readyz" "$(annotation healthcheck-path) == \"/readyz\""
check "Ingress carries an ACM certificate ARN" "$(annotation certificate-arn) | test(\"^arn:aws:acm:ap-southeast-1:[0-9]{12}:certificate/\")"

if [ "$failures" -gt 0 ]; then
  echo "$failures check(s) failed for $OVERLAY" >&2
  exit 1
fi
echo "OK: $OVERLAY"
