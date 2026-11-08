#!/usr/bin/env bash
# Guards deploy/cashight/overlays/v2 against what the cluster would reject or
# silently mis-serve, before a cluster exists:
#   - schema (kubeconform, including the Argo Rollouts and KEDA CRDs);
#   - Pod Security "restricted" container settings;
#   - images pinned by digest;
#   - memory requests/limits on every container, and the namespace quota
#     (limits.memory 16Gi) at maximum scale plus one canary surge pod;
#   - the ALB (VPC CIDR) may reach the APIs on 8080; egress for AWS APIs and
#     the collector;
#   - terminationGracePeriodSeconds per the Plan 4c sizing table.
# Exit 1 with one FAIL line per problem.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

OVERLAY=${OVERLAY:-deploy/cashight/overlays/v2}
VPC_CIDR=10.0.0.0/16
QUOTA_LIMITS_MI=$((16 * 1024))
CRD_SCHEMAS='https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json'

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
kubeconform -strict -summary \
  -schema-location default -schema-location "$CRD_SCHEMAS" \
  <"$rendered" || fail "kubeconform"

# All documents as one JSON array, for jq.
docs=$(yq -o=json -I=0 '.' "$rendered" | jq -s '.')

# Pod templates of every workload kind, with the scale they can reach.
# Rollouts count one extra surge pod; ScaledObject targets use maxReplicaCount.
pods=$(jq '
  (map(select(.kind == "ScaledObject")) | map({key: .spec.scaleTargetRef.name, value: .spec.maxReplicaCount}) | from_entries) as $max
  | map(select(.kind == "Rollout" or .kind == "Deployment"))
  | map({
      name: .metadata.name,
      kind: .kind,
      scale: (if .kind == "Rollout" then (.spec.replicas + 1) else ($max[.metadata.name] // .spec.replicas) end),
      spec: .spec.template.spec
    })
' <<<"$docs")

containers=$(jq '[.[] | .name as $w | .spec.containers[] | . + {workload: $w}]' <<<"$pods")
jobs=$(jq '[.[] | select(.kind == "AnalysisTemplate") | .spec.metrics[].provider.job.spec.template.spec.containers[] | . + {workload: "smoke"}]' <<<"$docs")
all=$(jq -s 'add' <(echo "$containers") <(echo "$jobs"))

while IFS= read -r problem; do
  [ -n "$problem" ] && fail "$problem"
done < <(jq -r '.[] |
  . as $c | "\($c.workload)/\($c.name)" as $id |
  (if .securityContext.runAsNonRoot != true then "\($id): runAsNonRoot" else empty end),
  (if .securityContext.allowPrivilegeEscalation != false then "\($id): allowPrivilegeEscalation" else empty end),
  (if .securityContext.readOnlyRootFilesystem != true then "\($id): readOnlyRootFilesystem" else empty end),
  (if (.securityContext.capabilities.drop // []) != ["ALL"] then "\($id): capabilities.drop [ALL]" else empty end),
  (if .securityContext.seccompProfile.type != "RuntimeDefault" then "\($id): seccompProfile RuntimeDefault" else empty end),
  (if (.image | test("@sha256:[0-9a-f]{64}$") | not) then "\($id): image not pinned by digest (\(.image))" else empty end),
  (if .resources.requests.memory == null or .resources.limits.memory == null then "\($id): memory request and limit" else empty end)
' <<<"$all")

to_mi() {
  case "$1" in
    *Gi) echo $((${1%Gi} * 1024)) ;;
    *Mi) echo "${1%Mi}" ;;
    *) echo "unparseable memory quantity: $1" >&2; echo 999999 ;;
  esac
}

total=0
while IFS=$'\t' read -r scale limit; do
  total=$((total + scale * $(to_mi "$limit")))
done < <(jq -r '.[] | .scale as $s | .spec.containers[] | "\($s)\t\(.resources.limits.memory // "0Mi")"' <<<"$pods")
# The smoke Job runs once per analysis step, one at a time.
while IFS= read -r limit; do
  total=$((total + $(to_mi "$limit")))
done < <(jq -r '.[0].resources.limits.memory // empty' <<<"$jobs")
[ "$total" -le "$QUOTA_LIMITS_MI" ] ||
  fail "limits.memory at max scale + surge is ${total}Mi, quota is ${QUOTA_LIMITS_MI}Mi"

# KEDA owns the replica count of a ScaledObject's target. A replicas field in
# the manifest makes Argo CD (selfHeal) reset every scale-up.
while IFS= read -r name; do
  [ -n "$name" ] && fail "$name: scaled by a ScaledObject, so it must not set spec.replicas"
done < <(jq -r '
  (map(select(.kind == "ScaledObject") | .spec.scaleTargetRef.name)) as $scaled
  | .[] | select(.kind == "Deployment" and (.metadata.name as $n | $scaled | index($n)) and (.spec | has("replicas")))
  | .metadata.name' <<<"$docs")

expect_grace() {
  local name=$1 want=$2 got
  got=$(jq -r --arg n "$name" '.[] | select(.name == $n) | .spec.terminationGracePeriodSeconds' <<<"$pods")
  [ "$got" = "$want" ] || fail "$name: terminationGracePeriodSeconds $got, want $want"
}
expect_grace cashight-api 45
expect_grace cashight-aws-api 45
expect_grace parser-worker 150
expect_grace invoice-parser-worker 330

netpols=$(jq '[.[] | select(.kind == "NetworkPolicy")]' <<<"$docs")
jq -e --arg cidr "$VPC_CIDR" 'any(.[];
    (.spec.policyTypes | index("Ingress")) and
    any(.spec.ingress[]?; any(.from[]?; .ipBlock.cidr == $cidr) and any(.ports[]?; .port == 8080)))' \
  <<<"$netpols" >/dev/null || fail "no NetworkPolicy admits TCP 8080 from $VPC_CIDR"
jq -e --arg cidr "$VPC_CIDR" '[.[] | .spec.ingress[]? | .from[]? | .ipBlock.cidr // empty] | all(. == $cidr)' \
  <<<"$netpols" >/dev/null || fail "an ingress ipBlock other than $VPC_CIDR"
jq -e 'any(.[]; any(.spec.egress[]?; any(.to[]?; .ipBlock.cidr == "0.0.0.0/0") and any(.ports[]?; .port == 443)))' \
  <<<"$netpols" >/dev/null || fail "no egress to TCP 443"
jq -e 'any(.[]; any(.spec.egress[]?;
    any(.to[]?; .namespaceSelector.matchLabels["kubernetes.io/metadata.name"] == "observability") and
    any(.ports[]?; .port == 4318)))' \
  <<<"$netpols" >/dev/null || fail "no egress to observability TCP 4318"

if [ "$failures" -gt 0 ]; then
  echo "check-cashight-manifests: $failures problem(s)" >&2
  exit 1
fi
echo "check-cashight-manifests: PASS (limits.memory at max scale ${total}Mi)"
