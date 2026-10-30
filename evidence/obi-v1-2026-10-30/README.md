# OBI v1.0.0 local smoke test

The upgraded demo ran in a fresh ARM64 kind cluster on 30 October 2026. This is a smoke test of application telemetry and Cilium coexistence, not a performance benchmark. The September benchmark and embedded videos remain historical OBI v0.13.0 evidence.

## Versions and environment

| Component | Observed value |
| --- | --- |
| OBI application | `v1.0.0`, revision `d23be0d` |
| OBI configuration | Config v2, extension version `2.0` |
| OBI Helm chart | `0.15.2`, with an explicit `v1.0.0` application-image override |
| Cilium | `1.20.2` |
| Cluster | `obi-cilium-v1`, Kubernetes `v1.35.0`, three nodes |
| Node kernel | `6.12.76-linuxkit`, ARM64 |
| Ready agents | OBI `2/2`, Cilium `3/3` |

The cluster used a private kubeconfig. Existing clusters and the user's current Kubernetes context were not changed.

## Verified behavior

- The rollout route returned HTTP 200.
- OBI emitted request metrics for `edge-nginx`, `recommendations-v2`, and `recommendations-v1`. The expected HTTP latency histogram was present.
- Tempo stored a connected trace across all three services, with client and server spans. Trace ID: `1a05bca9b157823237ea84f354ecf9e3`.
- Cilium forwarding and Hubble flow metrics reached the same Grafana metrics backend. Collector accepted and exported span counters were both populated.
- All 47 PromQL queries across the three dashboards returned live series. This verifies query execution and data presence. It does not establish that every panel was visually inspected in a browser.
- The denial test began with a direct-to-v1 HTTP 200. With the policy applied, that request timed out and Hubble recorded 16 `POLICY_DENIED` events. The permitted v2-to-v1 rollout route still returned HTTP 200. After policy removal, the direct route returned HTTP 200 again. The test policy was confirmed absent afterward.

## Attachment scope

Cilium reported TCX, and `bpftool net show` on both workers listed its `tcx/ingress` and `tcx/egress` programs. OBI startup logs showed socket-message and socket-operations propagation. No OBI TC program appeared in the worker network-attachment lists.

This application configuration disables optional OBI network capture. The configured TCX backend therefore does not establish a shared OBI/Cilium TC chain in this run. The TC attachment manager is used by the optional network-flow collector. See the pinned [application instrumentation selection](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/pkg/appolly/discover/finder.go) and [socket propagation implementation](https://github.com/open-telemetry/opentelemetry-ebpf-instrumentation/blob/v1.0.0/pkg/internal/ebpf/tpinjector/tpinjector.go).

OBI also warned that bpffs was not mounted in its container. It used process-internal maps. External features that require pinned maps, such as profile correlation, were unavailable in this configuration and were not tested. Application metrics and traces were present despite that warning.

## Evidence

- [Results summary](results.json), [runtime metadata](runtime-metadata.json), and [installed Helm releases](helm-releases.json)
- [OBI startup logs](obi-startup.txt) and [Collector logs](collector.txt)
- [Cilium runtime status](cilium-status.txt)
- [Worker TCX attachments](tcx-worker.json) and [second-worker attachments](tcx-worker2.json)
- [Metric query results](metrics.json) and [dashboard query validation](dashboard-validation.txt)
- [Trace summary](trace-summary.json), [Tempo search](tempo-search.json), and [captured trace](tempo-trace.json)
- [Hubble flows](hubble-flows.jsonl)
- [Denial and recovery result](policy-smoke.json) and [policy-denied flow records](policy-denied-flows.jsonl)

No kubeconfig, registry credentials, or other authentication material is included in this evidence directory.

## Local inspection

The cluster and loopback-only port-forwards were left running:

- Application: <http://127.0.0.1:18080>
- Grafana: <http://127.0.0.1:13000>
- Hubble UI: <http://127.0.0.1:12001>

To repeat the query check against these forwards:

```bash
PROMETHEUS_URL=http://127.0.0.1:13000/api/datasources/proxy/uid/prometheus/api/v1/query \
  node scripts/validate-dashboards.mjs
```

The live links and trace retention depend on this local cluster remaining available. Use the repository setup instructions to recreate the demo.
