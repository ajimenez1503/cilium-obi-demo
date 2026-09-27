import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cluster = "obi-cilium-priority-recording";
const context = `kind-${cluster}`;
const namespace = "obi-nginx-example";
const stage = process.argv[2];
if (!new Set(["unsafe", "safe"]).has(stage)) throw new Error("Expected unsafe or safe");

async function run(file, args) {
  const { stdout, stderr } = await execFileAsync(file, args, {
    cwd: root, timeout: 45000, maxBuffer: 8 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

async function kubectl(args) {
  return run("kubectl", ["--context", context, ...args]);
}

const node = JSON.parse((await kubectl(["get", "nodes", "-o", "json"])).stdout).items[0];
const cilium = JSON.parse((await kubectl(["-n", "kube-system", "get", "configmap", "cilium-config", "-o", "json"])).stdout);
const obiConfig = JSON.parse((await kubectl(["-n", namespace, "get", "configmap", "obi-opentelemetry-ebpf-instrumentation", "-o", "json"])).stdout);
const daemonset = JSON.parse((await kubectl(["-n", namespace, "get", "daemonset", "obi-opentelemetry-ebpf-instrumentation", "-o", "json"])).stdout);
const pods = JSON.parse((await kubectl(["-n", namespace, "get", "pods", "-l", "app.kubernetes.io/name=opentelemetry-ebpf-instrumentation", "-o", "json"])).stdout);
const testRequest = await kubectl(["-n", namespace, "exec", "deployment/edge-nginx", "--", "wget", "-qO-", "http://edge-nginx"]);
const tc = await run("docker", ["exec", `${cluster}-control-plane`, "sh", "-c", "for d in /sys/class/net/lxc*; do n=${d##*/}; echo \"$n\"; tc filter show dev \"$n\" ingress; done"]);
const logs = await kubectl(["-n", namespace, "logs", "daemonset/obi-opentelemetry-ebpf-instrumentation", "--tail=120"]);

const error = logs.stdout.match(/Cilium compatibility error: detected Cilium TC with priority 1 - Cilium may clobber OBI/)?.[0] ?? null;
const filterPriorities = [...tc.stdout.matchAll(/filter protocol all pref (\d+) bpf chain 0 handle/g)].map((match) => Number(match[1]));
const httpSpan = logs.stdout.split("\n").find((line) => /HTTP\(subType=.*\) 200 GET/.test(line)) ?? null;
const evidence = {
  schemaVersion: "legacy-priority-demo.v1",
  stage,
  observedAt: new Date().toISOString(),
  cluster,
  context,
  kubernetesVersion: node.status.nodeInfo.kubeletVersion,
  kernelVersion: node.status.nodeInfo.kernelVersion,
  ciliumVersion: "1.20.2",
  obiImage: daemonset.spec.template.spec.containers[0].image,
  ciliumConfig: {
    enableTCX: cilium.data["enable-tcx"],
    filterPriority: cilium.data["bpf-filter-priority"] ?? null,
  },
  obiConfigText: obiConfig.data["ebpf-instrument-config.yml"],
  obiDesired: daemonset.status.desiredNumberScheduled,
  obiReady: daemonset.status.numberReady ?? 0,
  obiPods: pods.items.map((pod) => ({
    name: pod.metadata.name,
    phase: pod.status.phase,
    ready: pod.status.containerStatuses?.[0]?.ready ?? false,
    restartCount: pod.status.containerStatuses?.[0]?.restartCount ?? 0,
    waitingReason: pod.status.containerStatuses?.[0]?.state?.waiting?.reason ?? null,
  })),
  testRequestSucceeded: testRequest.stdout.includes("Welcome to nginx!"),
  filterPriorities,
  tcOutput: tc.stdout,
  obiCompatibilityError: error,
  obiHttpSpan: httpSpan,
  obiLogs: logs.stdout,
};

if (!evidence.testRequestSucceeded) throw new Error("The nginx request did not succeed");
if (!filterPriorities.includes(stage === "unsafe" ? 1 : 2)) throw new Error(`Expected Cilium priority for ${stage} was not observed`);
if (stage === "unsafe" && !/pref 1[^\n]*\nfilter protocol all pref 1[^\n]*cil_from_container/.test(tc.stdout)) {
  throw new Error("The unsafe node did not show Cilium at TC priority 1");
}
if (stage === "safe" && !/pref 1[^\n]*\nfilter protocol all pref 1[^\n]*obi_ingress_flo[\s\S]*?pref 2[^\n]*\nfilter protocol all pref 2[^\n]*cil_from_container/.test(tc.stdout)) {
  throw new Error("The safe node did not show OBI priority 1 before Cilium priority 2");
}
if (stage === "unsafe" && (!error || evidence.obiReady !== 0)) throw new Error("Unsafe guardrail evidence did not match expectation");
if (stage === "safe" && (error || evidence.obiReady !== 1 || !httpSpan)) throw new Error("Safe attachment evidence did not match expectation");

const dir = path.join(root, "evidence", "legacy-priority-2026-09-27");
await fs.mkdir(dir, { recursive: true });
const output = path.join(dir, `${stage}.json`);
await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify({ output, stage, priority: filterPriorities, obiReady: evidence.obiReady, error, httpSpan, testRequestSucceeded: evidence.testRequestSucceeded }));
