import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputDir = resolve(scriptDir, "../demo/dashboards");
const datasource = { type: "prometheus", uid: "prometheus" };

mkdirSync(outputDir, { recursive: true });

function target(refId, expr, legendFormat = "", options = {}) {
  return {
    refId,
    expr,
    legendFormat,
    ...options,
  };
}

function stat(id, title, description, expr, unit, gridPos, options = {}) {
  return {
    id,
    type: "stat",
    title,
    description,
    gridPos,
    datasource,
    targets: [target("A", expr, options.legendFormat ?? "", { instant: true })],
    fieldConfig: {
      defaults: {
        unit,
        decimals: options.decimals,
        color: { mode: "thresholds" },
        thresholds: {
          mode: "absolute",
          steps: options.thresholds ?? [{ color: options.color ?? "green", value: null }],
        },
      },
      overrides: [],
    },
    options: {
      reduceOptions: { calcs: ["lastNotNull"], fields: "", values: false },
      orientation: "auto",
      textMode: "auto",
      colorMode: options.colorMode ?? "background",
      graphMode: "area",
      justifyMode: "auto",
      wideLayout: true,
    },
  };
}

function timeseries(id, title, description, targets, unit, gridPos, options = {}) {
  return {
    id,
    type: "timeseries",
    title,
    description,
    gridPos,
    datasource,
    targets,
    fieldConfig: {
      defaults: {
        unit,
        decimals: options.decimals,
        min: options.min,
        max: options.max,
        color: { mode: "palette-classic" },
        custom: {
          drawStyle: "line",
          lineInterpolation: "smooth",
          lineWidth: 2,
          fillOpacity: 12,
          showPoints: "never",
          spanNulls: true,
          stacking: { mode: options.stack ? "normal" : "none", group: "A" },
        },
      },
      overrides: [],
    },
    options: {
      legend: {
        displayMode: "table",
        placement: "bottom",
        calcs: options.calcs ?? ["lastNotNull", "max"],
      },
      tooltip: { mode: "multi", sort: "desc" },
    },
  };
}

function barGauge(id, title, description, targets, unit, gridPos, options = {}) {
  return {
    id,
    type: "bargauge",
    title,
    description,
    gridPos,
    datasource,
    targets: targets.map((item) => ({ ...item, instant: true })),
    fieldConfig: {
      defaults: {
        unit,
        decimals: options.decimals,
        min: options.min,
        max: options.max,
        color: { mode: options.colorMode ?? "continuous-GrYlRd" },
      },
      overrides: [],
    },
    options: {
      orientation: "horizontal",
      displayMode: "gradient",
      showUnfilled: true,
      valueMode: "color",
      minVizWidth: 8,
      minVizHeight: 16,
      reduceOptions: { values: false, calcs: ["lastNotNull"], fields: "" },
    },
  };
}

function variable(name, label, query) {
  return {
    name,
    label,
    type: "query",
    datasource,
    query: { query, refId: `var-${name}` },
    definition: query,
    refresh: 1,
    sort: 1,
    multi: true,
    includeAll: true,
    allValue: ".*",
    current: { selected: true, text: ["All"], value: ["$__all"] },
    options: [],
  };
}

function dashboard(uid, title, description, panels, variables = []) {
  return {
    dashboard: {
      id: null,
      uid,
      title,
      description,
      tags: ["cilium-obi-demo", "ebpf"],
      timezone: "browser",
      schemaVersion: 42,
      version: 1,
      refresh: "5s",
      time: { from: "now-15m", to: "now" },
      links: [
        {
          type: "dashboards",
          title: "Cilium + OBI dashboards",
          tags: ["cilium-obi-demo"],
          asDropdown: true,
          includeVars: false,
          keepTime: true,
          targetBlank: false,
        },
      ],
      templating: { list: variables },
      panels,
    },
    overwrite: true,
    message: `Provision ${title}`,
  };
}

const obi = dashboard(
  "cilium-obi-application",
  "OBI Application Telemetry",
  "Zero-code HTTP metrics and trace-derived service relationships emitted by OBI.",
  [
    stat(1, "Request rate", "HTTP server requests observed by OBI.", 'sum(rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval]))', "reqps", { x: 0, y: 0, w: 6, h: 5 }, { color: "blue" }),
    stat(2, "5xx error rate", "Percentage of observed HTTP server requests returning a 5xx status.", '100 * sum(rate(http_server_request_duration_seconds_count{service_name=~"$service",http_response_status_code=~"5.."}[$__rate_interval])) / clamp_min(sum(rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval])), 0.000001)', "percent", { x: 6, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "orange", value: 1 }, { color: "red", value: 5 }] }),
    stat(3, "Server p95", "95th percentile server latency across selected services.", 'histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service_name=~"$service"}[$__rate_interval])))', "s", { x: 12, y: 0, w: 6, h: 5 }, { color: "purple" }),
    stat(4, "Instrumented services", "Distinct services currently emitting OBI HTTP server metrics.", 'count(count by (service_name) (http_server_request_duration_seconds_count{service_name=~"$service"}))', "short", { x: 18, y: 0, w: 6, h: 5 }, { color: "green" }),
    timeseries(5, "Request rate by service", "HTTP server request rate split by OBI service name.", [target("A", 'sum by (service_name) (rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval]))', "{{service_name}}")], "reqps", { x: 0, y: 5, w: 12, h: 9 }),
    timeseries(6, "Server latency percentiles", "Latency distribution from the OBI HTTP server histogram.", [
      target("A", 'histogram_quantile(0.50, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{service_name=~"$service"}[$__rate_interval])))', "p50 {{service_name}}"),
      target("B", 'histogram_quantile(0.95, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{service_name=~"$service"}[$__rate_interval])))', "p95 {{service_name}}"),
      target("C", 'histogram_quantile(0.99, sum by (le, service_name) (rate(http_server_request_duration_seconds_bucket{service_name=~"$service"}[$__rate_interval])))', "p99 {{service_name}}"),
    ], "s", { x: 12, y: 5, w: 12, h: 9 }),
    timeseries(7, "Responses by HTTP status", "Request rate grouped by response status and service.", [target("A", 'sum by (service_name, http_response_status_code) (rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval]))', "{{service_name}} HTTP {{http_response_status_code}}")], "reqps", { x: 0, y: 14, w: 12, h: 9 }, { stack: true }),
    timeseries(8, "Server and client spans", "Compare server-side observations with downstream client calls.", [
      target("A", 'sum by (service_name) (rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval]))', "server {{service_name}}"),
      target("B", 'sum by (service_name) (rate(http_client_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval]))', "client {{service_name}}"),
    ], "reqps", { x: 12, y: 14, w: 12, h: 9 }),
    timeseries(9, "Average HTTP body size", "Average request and response body sizes calculated from OBI histograms.", [
      target("A", 'sum by (service_name) (rate(http_server_request_body_size_bytes_sum{service_name=~"$service"}[$__rate_interval])) / clamp_min(sum by (service_name) (rate(http_server_request_body_size_bytes_count{service_name=~"$service"}[$__rate_interval])), 0.000001)', "request {{service_name}}"),
      target("B", 'sum by (service_name) (rate(http_server_response_body_size_bytes_sum{service_name=~"$service"}[$__rate_interval])) / clamp_min(sum by (service_name) (rate(http_server_response_body_size_bytes_count{service_name=~"$service"}[$__rate_interval])), 0.000001)', "response {{service_name}}"),
    ], "bytes", { x: 0, y: 23, w: 12, h: 9 }),
    barGauge(10, "Busiest routes", "Current request rate by normalized HTTP route.", [target("A", 'topk(10, sum by (service_name, http_route) (rate(http_server_request_duration_seconds_count{service_name=~"$service"}[$__rate_interval])))', "{{service_name}} {{http_route}}")], "reqps", { x: 12, y: 23, w: 12, h: 9 }, { colorMode: "continuous-BlPu" }),
    timeseries(11, "Trace-derived service edges", "Service graph request rate generated from OBI spans in Tempo.", [target("A", 'sum by (client, server) (rate(traces_service_graph_request_total[$__rate_interval]))', "{{client}} to {{server}}")], "reqps", { x: 0, y: 32, w: 12, h: 9 }),
    timeseries(12, "Failed service edges", "Failed service graph requests generated from OBI spans.", [target("A", 'sum by (client, server) (rate(traces_service_graph_request_failed_total[$__rate_interval]))', "{{client}} to {{server}}")], "reqps", { x: 12, y: 32, w: 12, h: 9 }),
  ],
  [variable("service", "OBI service", "label_values(http_server_request_duration_seconds_count, service_name)")],
);

const hubble = dashboard(
  "cilium-obi-hubble",
  "Hubble Network Telemetry",
  "Network flow, verdict, protocol, drop, TCP, ICMP, and loss telemetry from Hubble.",
  [
    stat(1, "Flows processed", "All Hubble flow events processed per second.", 'sum(rate(hubble_flows_processed_total{instance=~"$instance"}[$__rate_interval]))', "ops", { x: 0, y: 0, w: 6, h: 5 }, { color: "blue" }),
    stat(2, "Drops", "Hubble drop events per second.", 'sum(rate(hubble_drop_total{instance=~"$instance"}[$__rate_interval]))', "ops", { x: 6, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "orange", value: 0.01 }, { color: "red", value: 1 }] }),
    stat(3, "Lost events", "Hubble events lost before export per second.", 'sum(rate(hubble_lost_events_total{instance=~"$instance"}[$__rate_interval]))', "ops", { x: 12, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "red", value: 0.001 }] }),
    stat(4, "TCP resets", "Observed TCP RST flags per second.", 'sum(rate(hubble_tcp_flags_total{instance=~"$instance",flag="RST"}[$__rate_interval]))', "ops", { x: 18, y: 0, w: 6, h: 5 }, { color: "orange" }),
    timeseries(5, "Flows by verdict", "Processed Hubble flow rate grouped by verdict.", [target("A", 'sum by (verdict) (rate(hubble_flows_processed_total{instance=~"$instance"}[$__rate_interval]))', "{{verdict}}")], "ops", { x: 0, y: 5, w: 12, h: 9 }, { stack: true }),
    timeseries(6, "Flows by protocol", "Processed Hubble flow rate grouped by protocol.", [target("A", 'sum by (protocol) (rate(hubble_flows_processed_total{instance=~"$instance"}[$__rate_interval]))', "{{protocol}}")], "ops", { x: 12, y: 5, w: 12, h: 9 }, { stack: true }),
    timeseries(7, "Flows by observation point", "Flow rate by Hubble type and subtype.", [target("A", 'sum by (type, subtype) (rate(hubble_flows_processed_total{instance=~"$instance"}[$__rate_interval]))', "{{type}} / {{subtype}}")], "ops", { x: 0, y: 14, w: 12, h: 9 }),
    timeseries(8, "Flows by node endpoint", "Flow processing rate from each Hubble metrics endpoint.", [target("A", 'sum by (instance) (rate(hubble_flows_processed_total{instance=~"$instance"}[$__rate_interval]))', "{{instance}}")], "ops", { x: 12, y: 14, w: 12, h: 9 }),
    timeseries(9, "Drops by reason", "Network drops reported by Hubble, grouped by reason and protocol.", [target("A", 'sum by (reason, protocol) (rate(hubble_drop_total{instance=~"$instance"}[$__rate_interval]))', "{{reason}} {{protocol}}")], "ops", { x: 0, y: 23, w: 12, h: 9 }),
    timeseries(10, "TCP flags", "TCP flag activity observed by Hubble.", [target("A", 'sum by (flag, family) (rate(hubble_tcp_flags_total{instance=~"$instance"}[$__rate_interval]))', "{{family}} {{flag}}")], "ops", { x: 12, y: 23, w: 12, h: 9 }),
    timeseries(11, "ICMP activity", "ICMP messages grouped by address family and type.", [target("A", 'sum by (family, type) (rate(hubble_icmp_total{instance=~"$instance"}[$__rate_interval]))', "{{family}} {{type}}")], "ops", { x: 0, y: 32, w: 12, h: 9 }),
    timeseries(12, "Lost events by source", "Event loss grouped by the Hubble internal source.", [target("A", 'sum by (source) (rate(hubble_lost_events_total{instance=~"$instance"}[$__rate_interval]))', "{{source}}")], "ops", { x: 12, y: 32, w: 12, h: 9 }),
  ],
  [variable("instance", "Hubble endpoint", "label_values(hubble_flows_processed_total, instance)")],
);

const cilium = dashboard(
  "cilium-obi-cilium",
  "Cilium Datapath and Agent Health",
  "Forwarding, drops, BPF maps, endpoints, policy, controller health, and agent resources.",
  [
    stat(1, "Forwarded packets", "Cilium forwarded packets per second.", 'sum(rate(cilium_forward_count_total{instance=~"$instance"}[$__rate_interval]))', "pps", { x: 0, y: 0, w: 6, h: 5 }, { color: "blue" }),
    stat(2, "Datapath drops", "Cilium datapath drops per second.", 'sum(rate(cilium_drop_count_total{instance=~"$instance"}[$__rate_interval]))', "pps", { x: 6, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "orange", value: 0.01 }, { color: "red", value: 1 }] }),
    stat(3, "Failing controllers", "Current count of failing Cilium controllers.", 'sum(cilium_controllers_failing{instance=~"$instance"})', "short", { x: 12, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "red", value: 1 }] }),
    stat(4, "Ready endpoints", "Cilium-managed endpoints in ready state.", 'sum(cilium_endpoint_state{instance=~"$instance",endpoint_state="ready"})', "short", { x: 18, y: 0, w: 6, h: 5 }, { color: "green" }),
    timeseries(5, "Forwarding by direction", "Forwarded packets grouped by ingress and egress.", [target("A", 'sum by (direction) (rate(cilium_forward_count_total{instance=~"$instance"}[$__rate_interval]))', "{{direction}}")], "pps", { x: 0, y: 5, w: 12, h: 9 }),
    timeseries(6, "Drops by reason", "Datapath drops grouped by direction and reason.", [target("A", 'sum by (direction, reason) (rate(cilium_drop_count_total{instance=~"$instance"}[$__rate_interval]))', "{{direction}} {{reason}}")], "pps", { x: 12, y: 5, w: 12, h: 9 }),
    timeseries(7, "BPF map pressure", "Map occupancy relative to capacity. Values close to 100 percent need attention.", [target("A", 'max by (instance, map_name) (cilium_bpf_map_pressure{instance=~"$instance"})', "{{instance}} {{map_name}}")], "percentunit", { x: 0, y: 14, w: 12, h: 9 }, { min: 0, max: 1 }),
    timeseries(8, "Agent CPU", "Cilium agent CPU consumption by metrics endpoint.", [target("A", 'rate(cilium_process_cpu_seconds_total{instance=~"$instance"}[$__rate_interval])', "{{instance}}")], "cores", { x: 12, y: 14, w: 12, h: 9 }),
    timeseries(9, "Agent resident memory", "Cilium agent resident memory by metrics endpoint.", [target("A", 'cilium_process_resident_memory_bytes{instance=~"$instance"}', "{{instance}}")], "bytes", { x: 0, y: 23, w: 12, h: 9 }),
    timeseries(10, "Errors and warnings", "New Cilium error and warning log events by subsystem.", [target("A", 'sum by (level, subsystem) (rate(cilium_errors_warnings_total{instance=~"$instance"}[$__rate_interval]))', "{{level}} {{subsystem}}")], "ops", { x: 12, y: 23, w: 12, h: 9 }),
    barGauge(11, "Endpoint states", "Current endpoint count grouped by state.", [target("A", 'sum by (endpoint_state) (cilium_endpoint_state{instance=~"$instance"})', "{{endpoint_state}}")], "short", { x: 0, y: 32, w: 8, h: 9 }, { colorMode: "continuous-BlPu" }),
    barGauge(12, "Policy enforcement", "Current endpoint policy enforcement modes.", [target("A", 'sum by (enforcement) (cilium_policy_endpoint_enforcement_status{instance=~"$instance"})', "{{enforcement}}")], "short", { x: 8, y: 32, w: 8, h: 9 }, { colorMode: "continuous-BlPu" }),
    timeseries(13, "Policy implementation p95", "95th percentile policy implementation delay.", [target("A", 'histogram_quantile(0.95, sum by (le) (rate(cilium_policy_implementation_delay_bucket{instance=~"$instance"}[$__rate_interval])))', "p95")], "s", { x: 16, y: 32, w: 8, h: 9 }),
  ],
  [variable("instance", "Cilium endpoint", "label_values(cilium_version, instance)")],
);

const pipeline = dashboard(
  "cilium-obi-pipeline",
  "eBPF Telemetry Pipeline Health",
  "Cross-system signal volume, Collector delivery, resource cost, and loss indicators.",
  [
    stat(1, "OBI HTTP series", "Current OBI HTTP metric series count.", 'count({__name__=~"http_(server|client)_.*"})', "short", { x: 0, y: 0, w: 6, h: 5 }, { color: "purple" }),
    stat(2, "Cilium series", "Current Cilium metric series count.", 'count({__name__=~"cilium_.*"})', "short", { x: 6, y: 0, w: 6, h: 5 }, { color: "blue" }),
    stat(3, "Hubble series", "Current Hubble metric series count.", 'count({__name__=~"hubble_.*"})', "short", { x: 12, y: 0, w: 6, h: 5 }, { color: "cyan" }),
    stat(4, "Loss or refusal rate", "Hubble lost events plus Collector refused points and spans.", 'sum(rate(hubble_lost_events_total[$__rate_interval])) + sum(rate(otelcol_receiver_refused_metric_points_total[$__rate_interval])) + sum(rate(otelcol_receiver_refused_spans_total[$__rate_interval]))', "ops", { x: 18, y: 0, w: 6, h: 5 }, { thresholds: [{ color: "green", value: null }, { color: "red", value: 0.001 }] }),
    timeseries(5, "Application requests and network flows", "Application request rate and Hubble flow processing rate. Different units of work, shown together for timing correlation.", [
      target("A", 'sum(rate(http_server_request_duration_seconds_count[$__rate_interval]))', "OBI server requests/s"),
      target("B", 'sum(rate(hubble_flows_processed_total[$__rate_interval]))', "Hubble flows/s"),
      target("C", 'sum(rate(cilium_forward_count_total[$__rate_interval]))', "Cilium forwarded packets/s"),
    ], "ops", { x: 0, y: 5, w: 12, h: 9 }),
    timeseries(6, "Collector metric pipeline", "Metric points accepted by receiver and sent by exporter.", [
      target("A", 'sum by (receiver) (rate(otelcol_receiver_accepted_metric_points_total[$__rate_interval]))', "accepted {{receiver}}"),
      target("B", 'sum by (exporter) (rate(otelcol_exporter_sent_metric_points_total[$__rate_interval]))', "sent {{exporter}}"),
    ], "ops", { x: 12, y: 5, w: 12, h: 9 }),
    timeseries(7, "Collector trace pipeline", "Spans accepted by receiver and sent by exporter.", [
      target("A", 'sum by (receiver) (rate(otelcol_receiver_accepted_spans_total[$__rate_interval]))', "accepted {{receiver}}"),
      target("B", 'sum by (exporter) (rate(otelcol_exporter_sent_spans_total[$__rate_interval]))', "sent {{exporter}}"),
    ], "ops", { x: 0, y: 14, w: 12, h: 9 }),
    timeseries(8, "Refused or failed telemetry", "Receiver refusal and failure counters for metrics and spans.", [
      target("A", 'sum by (receiver) (rate(otelcol_receiver_refused_metric_points_total[$__rate_interval]))', "refused metrics {{receiver}}"),
      target("B", 'sum by (receiver) (rate(otelcol_receiver_failed_metric_points_total[$__rate_interval]))', "failed metrics {{receiver}}"),
      target("C", 'sum by (receiver) (rate(otelcol_receiver_refused_spans_total[$__rate_interval]))', "refused spans {{receiver}}"),
      target("D", 'sum by (receiver) (rate(otelcol_receiver_failed_spans_total[$__rate_interval]))', "failed spans {{receiver}}"),
    ], "ops", { x: 12, y: 14, w: 12, h: 9 }),
    timeseries(9, "Exporter queue size", "Current queued items by signal and exporter.", [target("A", 'sum by (data_type, exporter) (otelcol_exporter_queue_size)', "{{data_type}} {{exporter}}")], "short", { x: 0, y: 23, w: 12, h: 9 }),
    timeseries(10, "Cilium agent CPU and memory", "Aggregate Cilium agent process cost across nodes.", [
      target("A", 'sum(rate(cilium_process_cpu_seconds_total[$__rate_interval]))', "CPU cores"),
    ], "cores", { x: 12, y: 23, w: 6, h: 9 }),
    timeseries(11, "Cilium agent memory", "Aggregate resident memory across Cilium agents.", [target("A", 'sum(cilium_process_resident_memory_bytes)', "resident memory")], "bytes", { x: 18, y: 23, w: 6, h: 9 }),
    timeseries(12, "Loss indicators", "Hubble event loss and Collector receiver refusal rates.", [
      target("A", 'sum by (source) (rate(hubble_lost_events_total[$__rate_interval]))', "Hubble {{source}}"),
      target("B", 'sum by (receiver) (rate(otelcol_receiver_refused_metric_points_total[$__rate_interval]))', "metrics {{receiver}}"),
      target("C", 'sum by (receiver) (rate(otelcol_receiver_refused_spans_total[$__rate_interval]))', "spans {{receiver}}"),
    ], "ops", { x: 0, y: 32, w: 12, h: 9 }),
    timeseries(13, "Trace-derived service edges", "Service graph request rate generated from OBI traces.", [target("A", 'sum by (client, server) (rate(traces_service_graph_request_total[$__rate_interval]))', "{{client}} to {{server}}")], "reqps", { x: 12, y: 32, w: 12, h: 9 }),
  ],
);

const outputs = [
  ["obi-application.json", obi],
  ["hubble-network.json", hubble],
  ["cilium-datapath.json", cilium],
  ["telemetry-pipeline.json", pipeline],
];

for (const [name, content] of outputs) {
  writeFileSync(resolve(outputDir, name), `${JSON.stringify(content, null, 2)}\n`);
}

console.log(`Generated ${outputs.length} dashboards in ${outputDir}`);
