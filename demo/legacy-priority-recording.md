# Recorded legacy TC priority comparison

This is the fourth talk demo. The [video](../slides/recordings/demo-4-legacy-priority.mp4) replays actual terminal outputs from two fresh, single-node kind clusters recorded on 27 September 2026. It is not a continuous capture of one cluster being reconfigured. The [poster](../slides/recordings/demo-4-legacy-priority-poster.png), [unsafe evidence](../evidence/legacy-priority-2026-09-27/unsafe.json), and [safe evidence](../evidence/legacy-priority-2026-09-27/safe.json) support every displayed result.

Scope: Cilium 1.20.2, OBI image v0.13.0, OBI Helm chart 0.14.0, legacy Netlink TC, and OBI's optional `network.source: tc` feature. This run did not use the full three-service Grafana demo or measure performance. The app-only OBI configuration stayed ready with Cilium at priority 1; the incompatibility guard shown here applies to the optional TC network-flow mode in this pinned version.

## Reproduce

These commands create and delete only the cluster named `obi-cilium-priority-recording`. Confirm that no cluster with that name contains work you need before running them. Run from the repository root with Docker, kind, Helm, and kubectl installed.

```bash
kind create cluster --name obi-cilium-priority-recording \
  --config demo/legacy-priority-kind.yaml
helm --kube-context kind-obi-cilium-priority-recording install cilium cilium/cilium \
  --version 1.20.2 --namespace kube-system \
  -f demo/cilium-values-legacy-recording.yaml --wait
kubectl --context kind-obi-cilium-priority-recording create namespace obi-nginx-example
kubectl --context kind-obi-cilium-priority-recording apply -f demo/legacy-priority-app.yaml
helm --kube-context kind-obi-cilium-priority-recording install obi \
  open-telemetry/opentelemetry-ebpf-instrumentation --version 0.14.0 \
  --namespace obi-nginx-example -f demo/obi-values-legacy-recording.yaml
node scripts/capture-legacy-priority.mjs unsafe
```

The unsafe capture may need one or two retries while OBI starts and the compatibility error reaches the logs. Expect Cilium's `cil_from_container` at TC pref 1, the OBI compatibility error, and zero ready OBI pods. The nginx request still succeeds, so this run does not demonstrate a networking outage.

For the safe side, first delete that exact disposable cluster, then recreate it with Cilium priority 2. The OBI values stay unchanged:

```bash
kind delete cluster --name obi-cilium-priority-recording
kind create cluster --name obi-cilium-priority-recording \
  --config demo/legacy-priority-kind.yaml
helm --kube-context kind-obi-cilium-priority-recording install cilium cilium/cilium \
  --version 1.20.2 --namespace kube-system \
  -f demo/cilium-values-legacy-recording.yaml \
  -f demo/cilium-values-legacy-safe.yaml --wait
kubectl --context kind-obi-cilium-priority-recording create namespace obi-nginx-example
kubectl --context kind-obi-cilium-priority-recording apply -f demo/legacy-priority-app.yaml
helm --kube-context kind-obi-cilium-priority-recording install obi \
  open-telemetry/opentelemetry-ebpf-instrumentation --version 0.14.0 \
  --namespace obi-nginx-example -f demo/obi-values-legacy-recording.yaml --wait
node scripts/capture-legacy-priority.mjs safe
```

Expect OBI's `tc/ingress_flow_parse` at pref 1, Cilium's `cil_from_container` at pref 2, one ready OBI pod, and an HTTP 200 span. A request and process discovery may take a few seconds, so repeat the safe capture if the span has not appeared yet.

To rebuild the presentation replay from those JSON files:

```bash
node slides/source/record-legacy-priority.mjs
ffprobe -v error -show_entries format=duration \
  -of default=noprint_wrappers=1 slides/recordings/demo-4-legacy-priority.mp4
```

The script uses headless Google Chrome, ffmpeg, and the `playwright` Node package. Install Playwright locally if needed before rebuilding the replay. The slide deck is maintained at `slides/cilium-obi-session-deck-latest.pptx` and in the conference slides folder. The embedded video is also packaged in that deck.

## What the result does and does not show

- The priority-1 run demonstrates OBI's startup guard for this configuration, not packet loss or a failed nginx request.
- The priority-2 run shows both observed TC attachments, OBI readiness, and one observed HTTP span. It does not prove every workload or protocol is covered.
- Each run used a fresh cluster. Do not change TC priority in place on a production node to recreate this demo.

See the [OpenTelemetry compatibility guidance](https://opentelemetry.io/docs/zero-code/obi/cilium-compatibility/) for the broader TCX and legacy TC recommendations.
