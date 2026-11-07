#!/usr/bin/env bash
# Run the collector's local config (scripts/platform/render-collector.sh,
# config-local.yaml) in Docker on localhost:4318, exporting to Grafana Cloud
# with the same SSM parameters the in-cluster init container reads.
#
# <log-dir> is mounted at /var/log/local: the collector tails *.log there and
# writes everything it exports to collected.jsonl. Cashight's local
# verification run (docs/observability.md) points its telemetry drill
# at this collector and audits collected.jsonl.
#
# GRAFANA_CLOUD_PARAMETER_PATH defaults to terraform/platform's
# grafana_cloud_parameter_path output, or /cashight/grafana-cloud while no
# cluster state exists (the local drill runs without one). Requires AWS
# credentials, Docker, helm, kubectl and yq.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <log-dir>" >&2
  exit 2
fi
log_dir="$(cd "$1" && pwd)"

cd "$(git rev-parse --show-toplevel)"
prefix="${GRAFANA_CLOUD_PARAMETER_PATH:-$(terraform -chdir=terraform/platform output -raw grafana_cloud_parameter_path 2>/dev/null || echo /cashight/grafana-cloud)}"
region="${AWS_REGION:-ap-southeast-1}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -m 700 "$work/secrets"

# Same loop as the init container in the ApplicationSet, including dropping the
# CLI's trailing newline, which ${file:...} would otherwise keep.
for p in otlp-token otlp-endpoint instance-id; do
  value="$(aws ssm get-parameter --region "$region" --name "$prefix/$p" --with-decryption \
    --query Parameter.Value --output text)" || {
    echo "cannot read SSM parameter $prefix/$p" >&2
    exit 1
  }
  printf '%s' "$value" >"$work/secrets/$p"
  test -s "$work/secrets/$p" || {
    echo "empty SSM parameter $prefix/$p" >&2
    exit 1
  }
done

./scripts/platform/render-collector.sh "$work/render" >/dev/null
image="$(yq ea 'select(.kind == "DaemonSet") | .spec.template.spec.containers[] | select(.name == "opentelemetry-collector") | .image' "$work/render/manifests.yaml")"
chmod -R a+rX "$work/render"

echo "collector $image on localhost:4318, log dir $log_dir" >&2
docker run --rm -p 4318:4318 -e MY_POD_IP=0.0.0.0 \
  -v "$work/render:/cfg:ro" -v "$work/secrets:/secrets:ro" -v "$log_dir:/var/log/local" \
  "$image" --config=/cfg/config-local.yaml
