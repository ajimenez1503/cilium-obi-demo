import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const execFileAsync = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const evidenceDir = path.join(root, "evidence/legacy-priority-2026-09-27");
const outDir = path.join(root, "slides/recordings");
const unsafe = JSON.parse(await fs.readFile(path.join(evidenceDir, "unsafe.json"), "utf8"));
const safe = JSON.parse(await fs.readFile(path.join(evidenceDir, "safe.json"), "utf8"));
if (unsafe.obiReady !== 0 || !unsafe.obiCompatibilityError || safe.obiReady !== 1 || !safe.obiHttpSpan) {
  throw new Error("The live evidence does not prove the intended comparison");
}
if (!/pref 1.*cil_from_container/.test(unsafe.tcOutput.replace(/\n/g, " ")) ||
    !/pref 1.*obi_ingress_flo.*pref 2.*cil_from_container/.test(safe.tcOutput.replace(/\n/g, " "))) {
  throw new Error("The saved tc output does not show the expected attachment order");
}

const escapeHtml = (s) => String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const unsafeTc = unsafe.tcOutput.split("\n").find((line) => /pref 1.*cil_from_container/.test(line));
const safeObiTc = safe.tcOutput.split("\n").find((line) => /pref 1.*obi_ingress_flo/.test(line));
const safeCiliumTc = safe.tcOutput.split("\n").find((line) => /pref 2.*cil_from_container/.test(line));
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}body{margin:0;background:#f9fbfd;color:#071b31;font-family:Arial,sans-serif}
.head{height:106px;background:#071b31;color:white;padding:19px 42px}.head h1{font-size:31px;margin:0 0 7px}.head p{margin:0;color:#b4d8ed;font-size:17px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:26px 42px 0}.box{height:610px;border:2px solid #a6b2bb;border-radius:13px;background:#fff;overflow:hidden}
.box.unsafe{border-color:#e84654}.box.safe{border-color:#08b9e7}.bar{font-weight:700;font-size:25px;padding:17px 23px;color:white}.unsafe .bar{background:#c63243}.safe .bar{background:#007cad}
.body{padding:24px;font-size:21px;line-height:1.45}.line{margin-bottom:13px}.label{color:#576776;font-size:17px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}.cmd{font-family:Menlo,monospace;font-size:17px;background:#edf3f7;padding:13px;border-radius:6px;margin:8px 0 20px;white-space:pre-wrap;overflow-wrap:anywhere}.bad{color:#b72d3b;font-weight:700}.good{color:#008267;font-weight:700}.hidden{visibility:hidden}.foot{margin:14px 42px;color:#546575;font-size:17px}.foot b{color:#071b31}
</style></head><body><div class="head"><h1>Legacy TC: one priority change, different OBI outcome</h1><p>Actual outputs from two fresh kind runs, replayed for presentation</p></div>
<div class="cols"><section class="box unsafe"><div class="bar">Priority 1: OBI guard stops startup</div><div class="body">
<div class="line hidden" id="u1"><div class="label">Cilium</div><div class="cmd">TCX: ${escapeHtml(unsafe.ciliumConfig.enableTCX)}  |  TC priority: 1</div></div>
<div class="line hidden" id="u2"><div class="label">Host veth ingress, tc readback</div><div class="cmd">${escapeHtml(unsafeTc)}</div></div>
<div class="line hidden" id="u3"><div class="label">OBI log</div><div class="cmd bad">${escapeHtml(unsafe.obiCompatibilityError)}</div></div>
<div class="line hidden" id="u4"><span class="bad">OBI ready: 0/1</span><br>nginx request: HTTP 200</div>
</div></section><section class="box safe"><div class="bar">Priority 2: both TC programs attach</div><div class="body">
<div class="line hidden" id="s1"><div class="label">Cilium</div><div class="cmd">TCX: ${escapeHtml(safe.ciliumConfig.enableTCX)}  |  TC priority: ${escapeHtml(safe.ciliumConfig.filterPriority)}</div></div>
<div class="line hidden" id="s2"><div class="label">Host veth ingress, tc readback</div><div class="cmd">${escapeHtml(safeObiTc)}<br>${escapeHtml(safeCiliumTc)}</div></div>
<div class="line hidden" id="s3"><div class="label">OBI and HTTP request</div><div class="cmd good">OBI ready: 1/1<br>nginx request: HTTP 200<br>${escapeHtml(safe.obiHttpSpan.match(/HTTP\(subType=.*?\) 200 GET \/\(\/\)/)?.[0] ?? "HTTP 200 GET /")}</div></div>
</div></section></div><div class="foot"><b>Scope:</b> OBI v0.13.0 with optional <code>network.source: tc</code>. This is not an app-only OBI startup failure.</div>
<script>window.show=(id)=>document.getElementById(id).classList.remove("hidden")</script></body></html>`;

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--disable-dev-shm-usage"] });
let raw;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 810 }, recordVideo: { dir: path.join(outDir, "raw"), size: { width: 1440, height: 810 } } });
  const page = await context.newPage();
  await page.setContent(html);
  const reveal = async (id, ms) => { await page.evaluate((name) => window.show(name), id); await page.waitForTimeout(ms); };
  await page.waitForTimeout(1200);
  await reveal("u1", 1800); await reveal("u2", 2600); await reveal("u3", 3500); await reveal("u4", 3000);
  await reveal("s1", 1800); await reveal("s2", 3300); await reveal("s3", 3800);
  await page.screenshot({ path: path.join(outDir, "demo-4-legacy-priority-poster.png") });
  await page.waitForTimeout(1800);
  const video = page.video();
  await context.close();
  raw = await video.path();
} finally {
  await browser.close();
}
const mp4 = path.join(outDir, "demo-4-legacy-priority.mp4");
await execFileAsync("ffmpeg", ["-y", "-i", raw, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "22", "-movflags", "+faststart", mp4], { timeout: 120000, maxBuffer: 1024 * 1024 });
console.log(JSON.stringify({ mp4, poster: path.join(outDir, "demo-4-legacy-priority-poster.png"), unsafeObservedAt: unsafe.observedAt, safeObservedAt: safe.observedAt }));
