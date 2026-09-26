#!/usr/bin/env bash
set -euo pipefail

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_USER="${GRAFANA_USER:-admin}"
GRAFANA_PASSWORD="${GRAFANA_PASSWORD:-admin}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="${SCRIPT_DIR}/dashboards"

curl --fail --silent --show-error \
  --retry 20 \
  --retry-all-errors \
  --retry-delay 1 \
  "${GRAFANA_URL}/api/health" >/dev/null

# Remove the four superseded single-system dashboards after consolidation.
for uid in \
  cilium-obi-application \
  cilium-obi-hubble \
  cilium-obi-cilium \
  cilium-obi-pipeline; do
  curl --silent --show-error \
    --user "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
    --request DELETE \
    "${GRAFANA_URL}/api/dashboards/uid/${uid}" >/dev/null
done

for dashboard in "${DASHBOARD_DIR}"/*.json; do
  printf 'importing %s\n' "$(basename "${dashboard}")"
  curl --fail-with-body --silent --show-error \
    --user "${GRAFANA_USER}:${GRAFANA_PASSWORD}" \
    --header 'Content-Type: application/json' \
    --data @"${dashboard}" \
    "${GRAFANA_URL}/api/dashboards/db"
  printf '\n'
done
