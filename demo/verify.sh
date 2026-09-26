#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-obi-cilium-talk}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"

kubectl --context "${KUBE_CONTEXT}" get nodes -o wide
kubectl --context "${KUBE_CONTEXT}" get pods -A

printf '\nCilium runtime status\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system exec daemonset/cilium -c cilium-agent -- cilium-dbg status --verbose \
  | grep -E 'Attach Mode|KubeProxyReplacement|Hubble|Routing|Host firewall' || true

printf '\nCilium configuration readback\n'
kubectl --context "${KUBE_CONTEXT}" -n kube-system get configmap cilium-config \
  -o jsonpath='{.data.enable-tcx}{"\n"}'

printf '\nOBI images and readiness\n'
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example get daemonset obi-opentelemetry-ebpf-instrumentation \
  -o jsonpath='{.spec.template.spec.containers[0].image}{" ready="}{.status.numberReady}{" desired="}{.status.desiredNumberScheduled}{"\n"}'

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
