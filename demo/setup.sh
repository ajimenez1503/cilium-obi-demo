#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${CLUSTER_NAME:-obi-cilium-talk}"
CILIUM_VERSION="${CILIUM_VERSION:-1.20.2}"
OBI_CHART_VERSION="${OBI_CHART_VERSION:-0.14.0}"
OBI_UPSTREAM_COMMIT="${OBI_UPSTREAM_COMMIT:-1d0b44040a861ac092261096491a7b3a1f269531}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UPSTREAM_DIR="${OBI_UPSTREAM_DIR:-${PROJECT_DIR}/obi-cilium-demo-upstream}"
KUBE_CONTEXT="kind-${CLUSTER_NAME}"

CILIUM_VALUES_ARGS=(-f "${SCRIPT_DIR}/cilium-values.yaml")
if [[ -n "${CILIUM_EXTRA_VALUES:-}" ]]; then
  CILIUM_VALUES_ARGS+=(-f "${CILIUM_EXTRA_VALUES}")
fi

OBI_VALUES_ARGS=(-f "${SCRIPT_DIR}/obi-values.yaml")
if [[ -n "${OBI_EXTRA_VALUES:-}" ]]; then
  OBI_VALUES_ARGS+=(-f "${OBI_EXTRA_VALUES}")
fi

for tool in docker kind kubectl helm git curl; do
  command -v "${tool}" >/dev/null 2>&1 || {
    printf 'missing required command: %s\n' "${tool}" >&2
    exit 1
  }
done

docker version --format '{{.Server.Version}}' >/dev/null

if kind get clusters | grep -Fxq "${CLUSTER_NAME}"; then
  printf 'cluster %s already exists; reuse it or delete it explicitly\n' "${CLUSTER_NAME}" >&2
  exit 1
fi

if [[ ! -d "${UPSTREAM_DIR}/.git" ]]; then
  git clone https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation.git "${UPSTREAM_DIR}"
fi

if [[ -n "$(git -C "${UPSTREAM_DIR}" status --porcelain)" ]]; then
  printf 'upstream checkout has local changes: %s\n' "${UPSTREAM_DIR}" >&2
  exit 1
fi

git -C "${UPSTREAM_DIR}" fetch --depth 1 origin "${OBI_UPSTREAM_COMMIT}"
git -C "${UPSTREAM_DIR}" checkout --detach "${OBI_UPSTREAM_COMMIT}"

kind create cluster --name "${CLUSTER_NAME}" --config "${SCRIPT_DIR}/kind-config.yaml"
kubectl config use-context "${KUBE_CONTEXT}" >/dev/null

docker exec "${CLUSTER_NAME}-worker" test -r /sys/kernel/btf/vmlinux
docker exec "${CLUSTER_NAME}-worker" test -d /sys/kernel/tracing
printf 'node kernel: '
docker exec "${CLUSTER_NAME}-worker" uname -r

helm repo add cilium https://helm.cilium.io/ --force-update
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts --force-update

helm upgrade --install cilium cilium/cilium \
  --version "${CILIUM_VERSION}" \
  --namespace kube-system \
  --kube-context "${KUBE_CONTEXT}" \
  "${CILIUM_VALUES_ARGS[@]}" \
  --wait \
  --timeout 10m

kubectl --context "${KUBE_CONTEXT}" -n kube-system rollout status daemonset/cilium --timeout=5m
kubectl --context "${KUBE_CONTEXT}" wait --for=condition=Ready nodes --all --timeout=5m

docker build \
  -t obi-nginx-traffic:local \
  -f "${UPSTREAM_DIR}/examples/nginx/traffic-runner/Dockerfile" \
  "${UPSTREAM_DIR}/examples/nginx"

kind load docker-image obi-nginx-traffic:local --name "${CLUSTER_NAME}"

kubectl --context "${KUBE_CONTEXT}" apply -k "${UPSTREAM_DIR}/examples/nginx/k8s"

kubectl --context "${KUBE_CONTEXT}" apply -f "${SCRIPT_DIR}/cilium-metrics-collector.yaml"
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example rollout status deployment/cilium-metrics-collector --timeout=5m

helm upgrade --install obi open-telemetry/opentelemetry-ebpf-instrumentation \
  --version "${OBI_CHART_VERSION}" \
  --namespace obi-nginx-example \
  --kube-context "${KUBE_CONTEXT}" \
  "${OBI_VALUES_ARGS[@]}" \
  --wait \
  --timeout 10m

kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example rollout status daemonset/obi-opentelemetry-ebpf-instrumentation --timeout=5m
kubectl --context "${KUBE_CONTEXT}" -n obi-nginx-example wait --for=condition=Available deployments --all --timeout=10m

"${SCRIPT_DIR}/verify.sh"
