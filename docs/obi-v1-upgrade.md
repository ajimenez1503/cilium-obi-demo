# OBI v1 demo upgrade

The default demo uses OBI core `v1.0.0`, released on October 30, 2026. The
application version and Helm chart version are independent. The published Helm
chart is `0.15.2`, so `demo/obi-values.yaml` explicitly overrides its default
`v0.15.2` image with `v1.0.0`. Read the deployed image and startup log, rather
than the chart's `app.kubernetes.io/version` label, to confirm the application.

## Pinned versions

| Component | Default demo |
| --- | --- |
| OBI image | `ghcr.io/open-telemetry/opentelemetry-ebpf-instrumentation/ebpf-instrument:v1.0.0` |
| OBI Helm chart | `0.15.2` |
| OBI example source | `d23be0d6b709c7e7047067c7e32c2500deee51dd`, the `v1.0.0` release commit |
| Cilium Helm chart and application | `1.20.2` |
| OBI configuration | Config v2, `extensions.obi.version: "2.0"` |

The Config v2 contract is a stable surface in OBI v1. Config v1 remains a frozen
compatibility input. Telemetry and attributes have individual stability levels,
and the embedded Collector receiver has a separate v0 release line. A core v1
tag does not make every feature or attribute stable.

## Configuration changes

- Kubernetes inclusion rules select only `edge-nginx`, `recommendations-v1`,
  and `recommendations-v2` in `obi-nginx-example`. This avoids ambiguous
  port-based discovery and instrumenting the telemetry pipeline itself.
- Capture selection, HTTP routes, request-header tracking, TCP propagation,
  and the optional TC collector's backend selection move under
  `extensions.obi.capture`.
- Kubernetes enrichment and service-name resolution move under
  `extensions.obi.enrich`.
- Traces use `tracer_provider`; metrics use `meter_provider`. Both export to
  LGTM's OTLP/gRPC endpoint at `http://lgtm:4317`, with a 15-second metric
  interval. The previous Config v1 file used OTLP/HTTP on port 4318.
- Config v2 values are explicit. The previous `OTEL_EBPF_*` environment
  overrides are removed because Config v2 does not apply them implicitly.
- OBI network-volume collection and TCP statistics remain disabled in the
  default demo. Hubble provides network-flow evidence. TCP trace propagation
  remains enabled with `context_propagation: all` and uses `SK_MSG` and
  `SOCK_OPS` socket hooks in both OBI v0.13.0 and v1.0.0. The separate
  `control_backend: tcx` setting selects TCX if optional TC network-flow
  collection is enabled. It does not activate a TC collector. No OBI TC
  program is expected in the default application-only demo.

## Run in a fresh local cluster

Use a private kubeconfig so kind does not select a different context in your
normal kubeconfig. No production cluster is required.
Verification requires host `python3` for standard-library JSON parsing. No
additional Python packages are needed.

```bash
mkdir -p .demo
KUBECONFIG="$PWD/.demo/obi-v1-kubeconfig" \
  CLUSTER_NAME=obi-cilium-v1 \
  OBI_UPSTREAM_DIR="$PWD/.demo/obi-upstream-v1" \
  ./demo/setup.sh

KUBECONFIG="$PWD/.demo/obi-v1-kubeconfig" \
  CLUSTER_NAME=obi-cilium-v1 \
  ./demo/verify.sh
```

The setup refuses to reuse an existing cluster name. All deployment and
verification commands target the named kind context explicitly.

To upgrade an existing local demo, pin the chart and apply the complete values
file. Use that demo's kubeconfig and context, then verify it:

```bash
helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts
helm repo update open-telemetry
helm upgrade --install obi open-telemetry/opentelemetry-ebpf-instrumentation \
  --version 0.15.2 --namespace obi-nginx-example \
  --kube-context kind-obi-cilium-talk \
  -f demo/obi-values.yaml --wait --timeout 10m
CLUSTER_NAME=obi-cilium-talk ./demo/verify.sh
```

## Validate telemetry after the upgrade

1. Confirm that both OBI pods are ready and use the `v1.0.0` image. The
   verification script also runs the image's Config v2 validator against the
   mounted file. OBI has no `--version` flag.
2. Generate traffic through `edge-nginx`. Confirm that Grafana has application
   request rate, errors, and latency for the three workloads, and that Tempo
   contains the expected service spans. Confirm Cilium and Hubble metric panels
   separately. The verification script requires a positive request-counter
   increase within two minutes for all three workloads. It retries for up to
   50 seconds, then fails on API errors or missing recent application metrics.
   Keep the traffic generator running when verifying. Readiness alone does not
   establish telemetry delivery.
3. Check dashboard and alert selectors against the emitted labels. Releases
   since the old `v0.13.0` demo changed default metric attributes, Prometheus
   labels, span names, and `rpc.method` values. The route and latency panels
   must be checked using current telemetry.
4. Restart a demo workload, send traffic again, and confirm metric emission.
   OBI v1 documents an intermittent missing-application-metrics symptom after
   Pod startup or restart. Restarting OBI is the documented recovery when this
   occurs. Record the symptom and recovery rather than treating empty data as
   zero traffic.
5. Inspect the active attachments and test policy behavior. This demo shows
   Cilium TCX programs and OBI socket hooks, rather than a shared OBI/Cilium TC
   chain. Do not infer OBI attachments from the configured backend name or
   Cilium's attach-mode status. A v1 compatibility contract
   does not guarantee that arbitrary eBPF programs or kernel attachments work
   together in every configuration.

OBI v1 also documents child spans occasionally starting before their parents.
Do not interpret every span timestamp anomaly as application behavior. Workload
and peer identity can remain incomplete when runtime metadata is unavailable.

## Historical recordings and measurements

The legacy-priority recording remains pinned to OBI `v0.13.0` and Helm chart
`0.14.0`. Its optional TC network collector startup guard is a historical
experiment, not an OBI v1 result. `demo/obi-values-legacy-recording.yaml` is
unchanged. The application-only legacy overlay also explicitly retains the old
image and full Config v1 file. Select it with
`OBI_VALUES_FILE="$PWD/demo/obi-values-legacy.yaml"` and
`OBI_CHART_VERSION=0.14.0`. Do not merge it on top of the Config v2 default file.

The September 26 benchmark and existing recordings retain their original
version provenance. Updating the runnable demo does not turn those results into
v1 measurements. Measure v1 separately before making new overhead claims.

The [OBI v1 local smoke-test evidence](../evidence/obi-v1-2026-10-30/README.md)
records the upgraded runtime's versions, application metrics, connected trace,
dashboard queries, policy denial and recovery, and attachment observations.

## Sources

- [OBI v1 release announcement](https://opentelemetry.io/blog/2026/obi-v1-release/)
- [Core v1.0.0 release notes](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/releases/tag/v1.0.0)
- [Config v1 to v2 migration guide](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/devdocs/config/version-2.0/migration.md)
- [Config v2 reference](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/devdocs/config/version-2.0/config-v2.md)
- [Telemetry stability and emission limitations](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/TELEMETRY.md)
- [Helm chart 0.15.2](https://github.com/open-telemetry/opentelemetry-helm-charts/releases/tag/opentelemetry-ebpf-instrumentation-0.15.2)
