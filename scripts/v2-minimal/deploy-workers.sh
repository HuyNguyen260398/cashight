#!/usr/bin/env bash
# Deploys the two v2-minimal worker Lambdas from `pnpm build:lambdas` output:
# for each, upload the zip, publish a version, wait for the update to finish
# and point the `live` alias (the SQS event source mapping's target) at it.
#
# Before touching any code it appends `<function>=<live version>` for both
# functions to the state file, so rollback.sh can restore either alias even
# when the deploy stops halfway.
#
#   deploy-workers.sh <dist-lambdas-dir> <state-file>
set -euo pipefail

[ "$#" -eq 2 ] || {
  echo "usage: $0 <dist-lambdas-dir> <state-file>" >&2
  exit 1
}
dist=$1 state=$2

# bundle directory -> function name (terraform/v2-minimal/workers.tf)
workers=(
  "parser-worker:cashight-v2-parser-worker"
  "invoice-parser-worker:cashight-v2-invoice-parser-worker"
)

for worker in "${workers[@]}"; do
  bundle=${worker%%:*}
  # pdfjs needs its worker file next to the bundle at runtime (CLAUDE.md).
  for file in index.js pdf.worker.mjs; do
    [ -f "$dist/$bundle/$file" ] || {
      echo "deploy-workers: $dist/$bundle/$file not found; run pnpm build:lambdas" >&2
      exit 1
    }
  done
done

for worker in "${workers[@]}"; do
  function=${worker#*:}
  version=$(aws lambda get-alias --function-name "$function" --name live \
    --query FunctionVersion --output text)
  echo "$function=$version" >>"$state"
  echo "deploy-workers: $function live is version $version"
done

workdir=$(mktemp -d)
trap 'rm -rf "$workdir"' EXIT

for worker in "${workers[@]}"; do
  bundle=${worker%%:*} function=${worker#*:}
  zip_file="$workdir/$bundle.zip"
  (cd "$dist/$bundle" && zip -qr "$zip_file" .)
  version=$(aws lambda update-function-code --function-name "$function" \
    --zip-file "fileb://$zip_file" --publish --query Version --output text)
  aws lambda wait function-updated --function-name "$function"
  aws lambda update-alias --function-name "$function" --name live --function-version "$version" >/dev/null
  echo "deploy-workers: $function live -> version $version"
done
