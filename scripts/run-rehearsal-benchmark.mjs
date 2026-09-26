import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = path.join(workspace, "evidence", "benchmark-2026-09-26");
const namespace = "obi-nginx-example";
const context = "kind-obi-cilium-talk";
const obiDaemonSet = "obi-opentelemetry-ebpf-instrumentation";
const target = "http://127.0.0.1:18080/api/users/42/recommendations/v1/homepage-hero";
const samplesPerCondition = 5;
const requestsPerSample = 200;
const concurrency = 20;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: workspace,
    encoding: "utf8",
    timeout: options.timeout ?? 180000,
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function kubectl(args, options) {
  return run("kubectl", ["--context", context, ...args], options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAb(output) {
  const get = (pattern, label) => {
    const match = output.match(pattern);
    if (!match) throw new Error(`ApacheBench output is missing ${label}`);
    return Number(match[1]);
  };
  return {
    requestsPerSecond: get(/Requests per second:\s+([\d.]+)/, "requests per second"),
    failedRequests: get(/Failed requests:\s+(\d+)/, "failed requests"),
    p50Ms: get(/^\s*50%\s+(\d+)/m, "p50"),
    p95Ms: get(/^\s*95%\s+(\d+)/m, "p95"),
    p99Ms: get(/^\s*99%\s+(\d+)/m, "p99"),
    completedRequests: get(/Complete requests:\s+(\d+)/, "complete requests"),
    durationSeconds: get(/Time taken for tests:\s+([\d.]+)/, "duration"),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(values) {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

function groupFor(namespaceName, podName) {
  if (namespaceName === namespace && /^obi-opentelemetry-ebpf-instrumentation-/.test(podName)) return "obi";
  if (namespaceName === namespace && /^cilium-metrics-collector-/.test(podName)) return "collector";
  if (namespaceName === namespace && /^(edge-nginx|recommendations-v1|recommendations-v2)-/.test(podName)) return "application";
  if (namespaceName === "kube-system" && /^cilium-[a-z0-9]{5}$/.test(podName)) return "ciliumAgent";
  if (namespaceName === "kube-system" && /^hubble-/.test(podName)) return "hubble";
  return null;
}

async function resourceSnapshot() {
  const nodeList = JSON.parse(kubectl(["get", "nodes", "-o", "json"]));
  const pods = {};
  for (const item of nodeList.items) {
    const nodeName = item.metadata.name;
    const summary = JSON.parse(kubectl(["get", "--raw", `/api/v1/nodes/${nodeName}/proxy/stats/summary`]));
    for (const pod of summary.pods ?? []) {
      const namespaceName = pod.podRef.namespace;
      const podName = pod.podRef.name;
      const group = groupFor(namespaceName, podName);
      if (!group) continue;
      pods[`${namespaceName}/${podName}`] = {
        group,
        cpuCoreNanoSeconds: Number(pod.cpu?.usageCoreNanoSeconds ?? 0),
        memoryWorkingSetBytes: Number(pod.memory?.workingSetBytes ?? 0),
      };
    }
  }
  return { timeMs: Date.now(), pods };
}

function resourceDelta(start, end) {
  const elapsedSeconds = (end.timeMs - start.timeMs) / 1000;
  const groups = {};
  for (const [key, endPod] of Object.entries(end.pods)) {
    const startPod = start.pods[key];
    if (!startPod) continue;
    const group = endPod.group;
    groups[group] ??= { cpuCores: 0, memoryWorkingSetBytes: 0, podCount: 0 };
    groups[group].cpuCores += Math.max(0, endPod.cpuCoreNanoSeconds - startPod.cpuCoreNanoSeconds) / 1e9 / elapsedSeconds;
    groups[group].memoryWorkingSetBytes += endPod.memoryWorkingSetBytes;
    groups[group].podCount += 1;
  }
  return { elapsedSeconds, groups };
}

async function prometheusValue(query) {
  const url = new URL("http://127.0.0.1:13000/api/datasources/proxy/uid/prometheus/api/v1/query");
  url.searchParams.set("query", query);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Prometheus query failed: ${response.status} ${query}`);
  const body = await response.json();
  return Number(body.data?.result?.[0]?.value?.[1] ?? 0);
}

function hubbleLostEventsDirect() {
  const pods = JSON.parse(kubectl(["-n", "kube-system", "get", "pods", "-l", "k8s-app=cilium", "-o", "json"]));
  let total = 0;
  for (const pod of pods.items) {
    const podName = pod.metadata.name;
    const metrics = kubectl(["get", "--raw", `/api/v1/namespaces/kube-system/pods/${podName}:9965/proxy/metrics`]);
    for (const line of metrics.split("\n")) {
      const match = line.match(/^hubble_lost_events_total(?:\{[^}]*\})?\s+([\d.eE+-]+)$/);
      if (match) total += Number(match[1]);
    }
  }
  return total;
}

async function telemetrySnapshot() {
  return {
    acceptedSpans: await prometheusValue("sum(otelcol_receiver_accepted_spans_total)"),
    exportedSpans: await prometheusValue("sum(otelcol_exporter_sent_spans_total)"),
    hubbleLostEvents: hubbleLostEventsDirect(),
  };
}

async function runCondition(id, name) {
  console.log(`Starting condition ${id}: ${name}`);
  run("ab", ["-r", "-n", "40", "-c", "10", target], { timeout: 60000 });
  const telemetryStart = await telemetrySnapshot();
  const samples = [];
  for (let index = 1; index <= samplesPerCondition; index += 1) {
    const resourceStart = await resourceSnapshot();
    const output = run("ab", ["-r", "-n", String(requestsPerSample), "-c", String(concurrency), target], { timeout: 90000 });
    const resourceEnd = await resourceSnapshot();
    await fs.writeFile(path.join(outputDir, `${id.toLowerCase()}-sample-${index}.txt`), output);
    const parsed = parseAb(output);
    samples.push({ index, ...parsed, resources: resourceDelta(resourceStart, resourceEnd) });
    console.log(`${id} sample ${index}: ${parsed.requestsPerSecond.toFixed(2)} req/s, p95 ${parsed.p95Ms} ms, failures ${parsed.failedRequests}`);
    await sleep(1500);
  }
  if (id === "D") {
    console.log("Waiting 65 seconds for the Prometheus scrape to include the combined run");
    await sleep(65000);
  }
  const telemetryEnd = await telemetrySnapshot();
  const groupNames = ["application", "ciliumAgent", "hubble", "collector", "obi"];
  const resources = {};
  for (const group of groupNames) {
    const cpu = samples.map((sample) => sample.resources.groups[group]?.cpuCores ?? 0);
    const memory = samples.map((sample) => sample.resources.groups[group]?.memoryWorkingSetBytes ?? 0);
    resources[group] = { cpuCores: summarize(cpu), memoryWorkingSetBytes: summarize(memory) };
  }
  return {
    id,
    name,
    samples,
    summary: {
      requestsPerSecond: summarize(samples.map((sample) => sample.requestsPerSecond)),
      p50Ms: summarize(samples.map((sample) => sample.p50Ms)),
      p95Ms: summarize(samples.map((sample) => sample.p95Ms)),
      p99Ms: summarize(samples.map((sample) => sample.p99Ms)),
      failedRequests: samples.reduce((sum, sample) => sum + sample.failedRequests, 0),
      completedRequests: samples.reduce((sum, sample) => sum + sample.completedRequests, 0),
      resources,
      telemetryDelta: {
        acceptedSpans: telemetryEnd.acceptedSpans - telemetryStart.acceptedSpans,
        exportedSpans: telemetryEnd.exportedSpans - telemetryStart.exportedSpans,
        hubbleLostEvents: telemetryEnd.hubbleLostEvents - telemetryStart.hubbleLostEvents,
      },
    },
    telemetryStart,
    telemetryEnd,
  };
}

await fs.mkdir(outputDir, { recursive: true });
const originalTrafficReplicas = Number(JSON.parse(kubectl(["-n", namespace, "get", "deployment", "traffic-generator", "-o", "json"])).spec.replicas ?? 1);
const originalObi = JSON.parse(kubectl(["-n", namespace, "get", "daemonset", obiDaemonSet, "-o", "json"]));
if (originalObi.spec.template.spec.nodeSelector) throw new Error("Benchmark expects the OBI DaemonSet to start without a nodeSelector");

let baseline;
let combined;
try {
  kubectl(["-n", namespace, "scale", "deployment", "traffic-generator", "--replicas=0"]);
  kubectl(["-n", namespace, "wait", "--for=delete", "pod", "-l", "app=traffic-generator", "--timeout=120s"]);

  kubectl(["-n", namespace, "patch", "daemonset", obiDaemonSet, "--type=merge", "-p", '{"spec":{"template":{"spec":{"nodeSelector":{"benchmark-mode":"disabled"}}}}}']);
  await sleep(8000);
  baseline = await runCondition("B", "Cilium and Hubble, OBI disabled");

  kubectl(["-n", namespace, "patch", "daemonset", obiDaemonSet, "--type=json", "-p", '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]']);
  kubectl(["-n", namespace, "rollout", "status", `daemonset/${obiDaemonSet}`, "--timeout=180s"], { timeout: 200000 });
  await sleep(10000);
  combined = await runCondition("D", "Cilium, Hubble, and OBI with TCX propagation");
} finally {
  try {
    const current = JSON.parse(kubectl(["-n", namespace, "get", "daemonset", obiDaemonSet, "-o", "json"]));
    if (current.spec.template.spec.nodeSelector) {
      kubectl(["-n", namespace, "patch", "daemonset", obiDaemonSet, "--type=json", "-p", '[{"op":"remove","path":"/spec/template/spec/nodeSelector"}]']);
    }
    kubectl(["-n", namespace, "rollout", "status", `daemonset/${obiDaemonSet}`, "--timeout=180s"], { timeout: 200000 });
  } catch (error) {
    console.error(`OBI restore warning: ${error.message}`);
  }
  try {
    kubectl(["-n", namespace, "scale", "deployment", "traffic-generator", `--replicas=${originalTrafficReplicas}`]);
    kubectl(["-n", namespace, "rollout", "status", "deployment/traffic-generator", "--timeout=180s"], { timeout: 200000 });
  } catch (error) {
    console.error(`Traffic generator restore warning: ${error.message}`);
  }
}

if (!baseline || !combined) throw new Error("Benchmark did not complete both conditions");

const result = {
  schemaVersion: 1,
  capturedAt: new Date().toISOString(),
  context,
  target,
  method: {
    comparison: "B versus D on the same three-node kind cluster",
    samplesPerCondition,
    requestsPerSample,
    concurrency,
    warmupRequests: 40,
    backgroundTrafficPaused: true,
    caveat: "Local kind and kubectl port-forward rehearsal. These results are not production capacity numbers.",
  },
  baseline,
  combined,
  comparison: {
    throughputChangePercent: (combined.summary.requestsPerSecond.median / baseline.summary.requestsPerSecond.median - 1) * 100,
    p95ChangeMs: combined.summary.p95Ms.median - baseline.summary.p95Ms.median,
    p95ChangePercent: (combined.summary.p95Ms.median / baseline.summary.p95Ms.median - 1) * 100,
  },
  environment: {
    kubernetes: JSON.parse(kubectl(["version", "-o", "json"])),
    nodes: JSON.parse(kubectl(["get", "nodes", "-o", "json"])).items.map((item) => ({
      name: item.metadata.name,
      kernelVersion: item.status.nodeInfo.kernelVersion,
      containerRuntimeVersion: item.status.nodeInfo.containerRuntimeVersion,
      kubeletVersion: item.status.nodeInfo.kubeletVersion,
    })),
    ciliumImage: kubectl(["-n", "kube-system", "get", "daemonset", "cilium", "-o", "jsonpath={.spec.template.spec.containers[0].image}"]),
    obiImage: originalObi.spec.template.spec.containers[0].image,
  },
};

await fs.writeFile(path.join(outputDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
const mib = (bytes) => bytes / 1024 / 1024;
const report = `# OBI and Cilium local rehearsal benchmark\n\n` +
  `Captured: ${result.capturedAt}\n\n` +
  `Method: five samples per condition, ${requestsPerSample} requests per sample, concurrency ${concurrency}, after a 40-request warm-up. Background demo traffic was paused.\n\n` +
  `| Metric | B: Cilium + Hubble | D: Cilium + Hubble + OBI | Change |\n` +
  `| --- | ---: | ---: | ---: |\n` +
  `| Throughput median | ${baseline.summary.requestsPerSecond.median.toFixed(2)} req/s | ${combined.summary.requestsPerSecond.median.toFixed(2)} req/s | ${result.comparison.throughputChangePercent.toFixed(1)}% |\n` +
  `| p95 median | ${baseline.summary.p95Ms.median.toFixed(0)} ms | ${combined.summary.p95Ms.median.toFixed(0)} ms | ${result.comparison.p95ChangeMs.toFixed(0)} ms |\n` +
  `| Failed requests | ${baseline.summary.failedRequests} / ${baseline.summary.completedRequests} | ${combined.summary.failedRequests} / ${combined.summary.completedRequests} | 0 |\n` +
  `| OBI CPU median | 0 | ${combined.summary.resources.obi.cpuCores.median.toFixed(3)} cores | added |\n` +
  `| OBI working set median | 0 | ${mib(combined.summary.resources.obi.memoryWorkingSetBytes.median).toFixed(1)} MiB | added |\n` +
  `| Accepted spans delta | ${baseline.summary.telemetryDelta.acceptedSpans.toFixed(0)} | ${combined.summary.telemetryDelta.acceptedSpans.toFixed(0)} | |\n` +
  `| Exported spans delta | ${baseline.summary.telemetryDelta.exportedSpans.toFixed(0)} | ${combined.summary.telemetryDelta.exportedSpans.toFixed(0)} | |\n` +
  `| Hubble lost events delta | ${baseline.summary.telemetryDelta.hubbleLostEvents.toFixed(0)} | ${combined.summary.telemetryDelta.hubbleLostEvents.toFixed(0)} | |\n\n` +
  `${result.method.caveat}\n`;
await fs.writeFile(path.join(outputDir, "results.md"), report);
console.log(report);
