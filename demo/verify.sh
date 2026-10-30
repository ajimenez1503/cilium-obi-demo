#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-obi-cilium-talk}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"
command -v python3 >/dev/null 2>&1 || {
  printf 'missing required command: python3 (standard-library JSON validation)\n' >&2
  exit 1
}

kubectl --context "${KUBE_CONTEXT}" get nodes -o wide
kubectl --context "${KUBE_CONTEXT}" get pods -A

printf '\nCilium runtime status\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system exec daemonset/cilium -c cilium-agent -- cilium-dbg status --verbose \
  | grep -E 'Attach Mode|KubeProxyReplacement|Hubble|Routing|Host firewall' || true

printf '\nCilium configuration readback\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system get configmap cilium-config \
  -o jsonpath='{.data.enable-tcx}{"\n"}'

printf '\nOBI images and readiness\n'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example rollout status \
  daemonset/obi-opentelemetry-ebpf-instrumentation --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get daemonset obi-opentelemetry-ebpf-instrumentation \
  -o jsonpath='{.spec.template.spec.containers[0].image}{" ready="}{.status.numberReady}{" desired="}{.status.desiredNumberScheduled}{"\n"}'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get pods \
  -l app.kubernetes.io/instance=obi \
  -o jsonpath='{range .items[*]}{.metadata.name}{" imageID="}{.status.containerStatuses[0].imageID}{"\n"}{end}'

# The chart version label can differ from the explicitly pinned image tag.
# OBI has no --version flag; use the image readback and startup log together.
printf '\nOBI version and configuration readback\n'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example logs \
  daemonset/obi-opentelemetry-ebpf-instrumentation --all-pods=true --prefix \
  | grep -E 'OpenTelemetry eBPF Instrumentation|configuration loaded' || true
OBI_IMAGE="$(kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get \
  daemonset obi-opentelemetry-ebpf-instrumentation \
  -o jsonpath='{.spec.template.spec.containers[0].image}')"
if [[ "${OBI_IMAGE}" == *:v1.* ]]; then
  kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example exec \
    daemonset/obi-opentelemetry-ebpf-instrumentation -c ebpf-instrument -- \
    /obi config validate /etc/ebpf-instrument/config/ebpf-instrument-config.yml
else
  printf 'historical image %s: Config v2 validation skipped\n' "${OBI_IMAGE}"
fi

printf '\nOBI attachment or capability errors\n'
if kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example logs daemonset/obi-opentelemetry-ebpf-instrumentation --all-pods=true --prefix --since=5m \
  | grep -Ei 'error|failed|cilium.*priority|required system capabilities not present|disabl.*context propagation'; then
  printf 'review the matching OBI log lines above before using the demo\n' >&2
else
  printf 'no matching error lines found\n'
fi

printf '\nRecent Hubble flows for the demo namespace\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system exec daemonset/cilium -c cilium-agent -- \
  hubble observe --namespace obi-nginx-example --last 10 2>/dev/null || \
  printf 'node-local Hubble CLI readback unavailable; use Hubble Relay or Hubble UI\n'

printf '\nCilium metrics bridge\n'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get deployment cilium-metrics-collector
if kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example logs deployment/cilium-metrics-collector --since=5m \
  | grep -Ei 'exporter.*failed|scrape.*failed|connection refused|no such host'; then
  printf 'review the matching Collector log lines above before using Grafana metrics\n' >&2
else
  printf 'no matching Collector scrape or export errors found\n'
fi

printf '\nCilium and Hubble metric endpoints\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system get service cilium-agent hubble-metrics
kubectl --context "${KUBE_CONTEXT}" -n kube-system get endpoints cilium-agent hubble-metrics

printf '\nServices\n'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get services

printf '\nFresh application metrics from all three demo services\n'
# A positive increase in a two-minute window requires observed requests. The
# existence of an old counter, or successful Prometheus HTTP status, is not enough.
METRICS_QUERY='sum by (service_name) (increase(http_server_request_duration_seconds_count{service_name=~"edge-nginx|recommendations-v1|recommendations-v2"}[2m]))'
METRICS_READY=false
for attempt in 1 2 3 4 5 6; do
  if METRICS_JSON="$(kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example exec deployment/lgtm -- \
    curl -fsSG --data-urlencode "query=${METRICS_QUERY}" \
    http://127.0.0.1:9090/api/v1/query)"; then
    if printf '%s\n' "${METRICS_JSON}" | python3 -c '
import json, math, sys
expected = {"edge-nginx", "recommendations-v1", "recommendations-v2"}
try:
    response = json.load(sys.stdin)
    if response.get("status") != "success":
        raise ValueError("Prometheus API error: " + str(response.get("error", response)))
    data = response.get("data", {})
    if data.get("resultType") != "vector":
        raise ValueError("expected a Prometheus instant vector")
    observed = {}
    for item in data.get("result", []):
        service = item.get("metric", {}).get("service_name")
        if service in expected:
            count = float(item["value"][1])
            if math.isfinite(count) and count > 0:
                observed[service] = count
    missing = sorted(expected - observed.keys())
    if missing:
        raise ValueError("no positive request-count increase in the last two minutes for: " + ", ".join(missing))
    for service, count in sorted(observed.items()):
        print(service + ": recent request-count increase=" + str(count))
except (ValueError, TypeError, KeyError, IndexError) as error:
    print("application metric check failed: " + str(error), file=sys.stderr)
    sys.exit(1)
'; then
      METRICS_READY=true
      break
    fi
  fi
  if [[ "${attempt}" -lt 6 ]]; then
    printf 'waiting for fresh application metrics (%s/6); generate traffic if idle\n' "${attempt}" >&2
    sleep 10
  fi
done
if [[ "${METRICS_READY}" != true ]]; then
  printf 'verification failed: fresh metrics from all three services were not observed\n' >&2
  exit 1
fi
