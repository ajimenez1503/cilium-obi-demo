import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const dashboardDir = resolve(scriptDir, "../demo/dashboards");
const prometheusUrl = process.env.PROMETHEUS_URL ??
  "http://localhost:3000/api/datasources/proxy/uid/prometheus/api/v1/query";

const files = readdirSync(dashboardDir)
  .filter((name) => name.endsWith(".json"))
  .sort();

const uids = new Set();
let panelCount = 0;
let queryCount = 0;
let populatedCount = 0;

for (const file of files) {
  const wrapper = JSON.parse(readFileSync(resolve(dashboardDir, file), "utf8"));
  const current = wrapper.dashboard;

  if (!current?.uid || !current?.title || !Array.isArray(current?.panels)) {
    throw new Error(`${file}: missing dashboard uid, title, or panels`);
  }
  if (uids.has(current.uid)) {
    throw new Error(`${file}: duplicate dashboard uid ${current.uid}`);
  }
  uids.add(current.uid);

  const panelIds = new Set();
  for (const panel of current.panels) {
    panelCount += 1;
    if (panelIds.has(panel.id)) {
      throw new Error(`${file}: duplicate panel id ${panel.id}`);
    }
    panelIds.add(panel.id);

    for (const item of panel.targets ?? []) {
      if (!item.expr) continue;
      queryCount += 1;
      const expression = item.expr
        .replaceAll("$service", ".*")
        .replaceAll("$instance", ".*")
        .replaceAll("$__rate_interval", "1m");
      const url = new URL(prometheusUrl);
      url.searchParams.set("query", expression);
      const response = await fetch(url);
      const payload = await response.json();
      if (!response.ok || payload.status !== "success") {
        throw new Error(`${file} panel ${panel.id}: ${payload.error ?? response.statusText}`);
      }
      if ((payload.data?.result ?? []).length > 0) populatedCount += 1;
    }
  }
}

console.log(
  `Validated ${files.length} dashboards, ${panelCount} panels, and ${queryCount} PromQL queries; ${populatedCount} queries returned live series.`,
);
