// End-to-end test of the OFD -> SVG renderer using jsdom and the synthetic OFD
// package from test/fixtures/generate-synthetic-ofd.mjs (imported below, so the
// fixture on disk is always freshly generated and never stale).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import "./fixtures/generate-synthetic-ofd.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const fixtureDir = path.join(root, "test", "fixtures", "ofd");

// Build the package exactly like the Rust backend does.
function walk(dir, base, files, resources) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const rel = (base ? base + "/" : "") + entry.name;
    if (entry.isDirectory()) { walk(abs, rel, files, resources); continue; }
    const lower = rel.toLowerCase();
    if (lower.endsWith(".xml")) {
      files[rel] = fs.readFileSync(abs, "utf8");
    } else if (/\.(png|jpe?g|gif|bmp|webp|tiff?)$/.test(lower)) {
      const mime = lower.endsWith(".png") ? "image/png" : lower.match(/\.jpe?g$/) ? "image/jpeg" : "application/octet-stream";
      resources[rel] = `data:${mime};base64,` + fs.readFileSync(abs).toString("base64");
    }
  }
}
const files = {}, resources = {};
walk(fixtureDir, "", files, resources);
const pkg = { files, resources };

const html = fs.readFileSync(path.join(root, "ui/index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "ui/styles.css"), "utf8");
const dom = new JSDOM(html, { runScripts: "outside-only", pretendToBeVisual: true });
const { window } = dom;
const styleEl = window.document.createElement("style");
styleEl.textContent = css;
window.document.head.appendChild(styleEl);
const displayOf = (id) => window.getComputedStyle(window.document.getElementById(id)).display;

let dropHandler = null;
const invokeCalls = [];
window.__TAURI__ = {
  core: {
    invoke: (cmd) => {
      invokeCalls.push(cmd);
      if (cmd === "open_ofd_path" || cmd === "open_ofd") return Promise.resolve(pkg);
      return Promise.reject(new Error("unexpected command: " + cmd));
    },
  },
  window: { getCurrentWindow: () => ({ onDragDropEvent: (h) => { dropHandler = h; return Promise.resolve(); } }) },
};

window.eval(fs.readFileSync(path.join(root, "ui/app.js"), "utf8"));
await new Promise((r) => window.setTimeout(r, 50));

const launchChecks = [
  ["launch: loading overlay hidden", displayOf("loading") === "none"],
  ["launch: welcome visible", displayOf("welcome") !== "none"],
];

if (typeof dropHandler !== "function") { console.error("FAIL: drag-drop handler not registered"); process.exit(1); }
dropHandler({ payload: { type: "drop", paths: ["test.ofd"] } });
await new Promise((r) => window.setTimeout(r, 500));

const doc = window.document;
const page = doc.getElementById("page");
const out = page.innerHTML;
const title = doc.getElementById("doc-title").textContent;
const status = doc.getElementById("status-text").textContent;

const checks = [
  ["invoke open_ofd_path", invokeCalls.includes("open_ofd_path")],
  ["after open: loading hidden", displayOf("loading") === "none"],
  ["after open: page-wrap visible", displayOf("page-wrap") !== "none"],
  ["one <svg> page produced", (out.match(/<svg /g) || []).length === 1],
  ["svg has ofd-page class", /class="ofd-page"/.test(out)],
  ["page size 230x133.5mm viewBox", /viewBox="0 0 230 133\.5"/.test(out)],
  ["svg width in mm", /width="230mm"/.test(out)],
  ["white background rect", /<rect[^>]*fill="#ffffff"/.test(out)],
  ["template grid rendered (<path>)", /<path /.test(out)],
  ["closed template frame path", /d="M 0 0 L 198\.2 0 L 198\.2 85 L 0 85 Z"/.test(out)],
  ["path stroke-width from DrawParam", /stroke-width="0\.25"/.test(out)],
  ["brown label color rgb(156,74,9)", /rgb\(156,74,9\)/.test(out)],
  ["label inherits brown DrawParam fill", /fill="rgb\(156,74,9\)"[^>]*>旅客姓名<\/text>/.test(out)],
  ["title text 电子发票 present", /电子发票/.test(out)],
  ["passenger 示例旅客 present", /示例旅客/.test(out)],
  ["amount CNY 660.40 present", /CNY 660\.40/.test(out)],
  ["invoice number present", /00000000000000000001/.test(out)],
  ["text uses per-glyph x list", /<text[^>]*\sx="[^"]*\s[^"]*"/.test(out)],
  ["font-family SimSun/宋体 mapped", /SimSun|宋体/.test(out)],
  ["seal/QR image rendered (<image>)", /<image /.test(out)],
  ["image uses data URI", /href="data:image\//.test(out)],
  ["image positioned via CTM", /<image[^>]*transform="translate\(150 20\) matrix\(12 0 0 12 0 0\)"/.test(out)],
  ["doc title shows page count", /1 页/.test(title)],
  ["status shows opened", /已打开/.test(status)],
  ["print button enabled", doc.getElementById("btn-print").disabled === false],
  ["zoom controls enabled", doc.getElementById("btn-zoom-in").disabled === false],
];

let failed = 0;
for (const [name, ok] of [...launchChecks, ...checks]) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name);
  if (!ok) failed++;
}

if (failed) {
  console.error("\n--- SVG output (first 2000 chars) ---\n" + out.slice(0, 2000));
  console.error("\nstatus: " + status + " | title: " + title);
  process.exit(1);
}
console.log("\nAll " + (launchChecks.length + checks.length) + " OFD render checks passed.");
