#!/usr/bin/env bash
# Polls <api-url>/health until it reports the expected pod-template hash, which
# proves the ALB routes to the new pod: during a rolling update it keeps
# answering from the old one until the new target registers and the old one
# drains. Exit 1 on timeout, naming the last revision seen.
#
#   wait-revision.sh <api-url> <expected-hash> [timeout-seconds=180]
#
# CONNECT_TO=<host> connects to that host (the ALB) instead of resolving the
# API hostname, which stays in the URL for TLS and the Host header
# (api-endpoint.sh; first deploy, before the DNS record exists).
set -euo pipefail

[ "$#" -ge 2 ] && [ "$#" -le 3 ] || {
  echo "usage: $0 <api-url> <expected-hash> [timeout-seconds]" >&2
  exit 1
}
api_url=${1%/} expected=$2 timeout=${3:-180}
poll=${POLL_SECONDS:-5}

# The server reports only 1-16 lowercase letters or digits (start-api.ts).
[[ "$expected" =~ ^[a-z0-9]{1,16}$ ]] || {
  echo "wait-revision: '$expected' is not a pod-template hash" >&2
  exit 1
}

connect=()
if [ -n "${CONNECT_TO:-}" ]; then
  host=${api_url#*://}
  host=${host%%/*}
  connect=(--connect-to "${host%%:*}:443:${CONNECT_TO}:443")
fi

deadline=$((SECONDS + timeout))
last=none
while :; do
  body=$(curl -sS --max-time 5 ${connect[@]+"${connect[@]}"} "$api_url/health" 2>/dev/null || true)
  seen=$(jq -r '.revision // empty' <<<"$body" 2>/dev/null || true)
  [ -n "$seen" ] && last=$seen
  if [ "$seen" = "$expected" ]; then
    echo "wait-revision: $api_url/health reports $expected"
    exit 0
  fi
  if [ "$SECONDS" -ge "$deadline" ]; then
    echo "wait-revision: $api_url/health never reported $expected within ${timeout}s; last revision seen: $last" >&2
    exit 1
  fi
  sleep "$poll"
done
