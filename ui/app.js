/* OFD Reader - open a GB/T 33190 (OFD) fixed-layout document and render each
 * page to SVG. Backend (Rust) unzips the package and returns XML parts + assets;
 * this file resolves resources and draws text/path/image objects by coordinates. */
"use strict";

const OFD_NS = "http://www.ofdspec.org/2016";
const SVG_NS = "http://www.w3.org/2000/svg";

/* ---------------- generic helpers ---------------- */
function ln(el) { return el.localName || el.nodeName.split(":").pop(); }
function elemChildren(el) {
  const out = [];
  for (const c of el.childNodes) if (c.nodeType === 1) out.push(c);
  return out;
}
function childrenLocal(el, local) { return elemChildren(el).filter((c) => ln(c) === local); }
function firstLocal(el, local) {
  if (!el) return null;
  for (const c of elemChildren(el)) if (ln(c) === local) return c;
  return null;
}
function allLocal(root, local) {
  const out = [];
  if (!root || !root.getElementsByTagName) return out;
  const all = root.getElementsByTagName("*");
  for (const el of all) if (ln(el) === local) out.push(el);
  return out;
}
function firstTextLocal(root, local) {
  const el = allLocal(root, local)[0];
  return el ? el.textContent.trim() : null;
}
function escXml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escAttr(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function nums(str) {
  if (!str) return [];
  return String(str).trim().split(/[\s,]+/).filter((s) => s !== "").map(Number);
}

/* ---------------- path resolution ---------------- */
function normPath(p) {
  if (!p) return "";
  const parts = [];
  for (const seg of String(p).replace(/\\/g, "/").split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}
function dirOf(p) { const i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
function resolvePath(baseDir, ref) {
  if (!ref) return "";
  const r = String(ref).trim();
  if (r.startsWith("/")) return normPath(r);
  return normPath((baseDir ? baseDir + "/" : "") + r);
}

/* ---------------- colors & fonts ---------------- */
function parseColorEl(el) {
  if (!el) return { color: null, opacity: null };
  const v = el.getAttribute("Value");
  let color = null;
  if (v) {
    const n = nums(v);
    if (n.length >= 3) color = "rgb(" + [n[0], n[1], n[2]].map((x) => Math.max(0, Math.min(255, Math.round(x)))).join(",") + ")";
  }
  let opacity = null;
  const a = el.getAttribute("Alpha");
  if (a != null && a !== "") { const av = parseFloat(a); if (!isNaN(av)) opacity = Math.max(0, Math.min(1, av / 255)); }
  return { color, opacity };
}

function cssFontFamily(name) {
  const cjkFallback = '"宋体","SimSun","Microsoft YaHei",sans-serif';
  if (!name) return cjkFallback;
  if (/courier/i.test(name)) return '"' + name + '",monospace';
  if (/times/i.test(name)) return '"' + name + '",serif';
  if (/arial|helvet/i.test(name)) return '"' + name + '",sans-serif';
  if (name === "黑体" || /hei|yahei/i.test(name)) return '"' + name + '","SimHei","黑体",sans-serif';
  if (name === "楷体" || /kai/i.test(name)) return '"' + name + '","KaiTi","楷体",serif';
  if (name === "仿宋" || /fang|fs/i.test(name)) return '"' + name + '","FangSong","仿宋",serif';
  if (name === "宋体" || /song|simsun/i.test(name)) return '"' + name + '","SimSun","宋体",serif';
  return '"' + name + '",' + cjkFallback;
}

/* ---------------- resource context ---------------- */
function buildContext(resPaths, docDir, fileGetter) {
  const fonts = new Map();       // id -> FontName
  const drawParams = new Map();  // id -> element
  const multimedia = new Map();  // id -> { path, format }

  for (const rp of resPaths) {
    if (!rp) continue;
    const txt = fileGetter(rp);
    if (!txt) continue;
    const doc = parseXml(txt);
    if (!doc) continue;
    const root = doc.documentElement;
    const resBase = resolvePath(docDir, root.getAttribute("BaseLoc") || "");
    for (const f of allLocal(doc, "Font")) {
      const id = f.getAttribute("ID");
      if (id != null) fonts.set(id, f.getAttribute("FontName") || f.getAttribute("FamilyName") || "");
    }
    for (const d of allLocal(doc, "DrawParam")) {
      const id = d.getAttribute("ID");
      if (id != null) drawParams.set(id, d);
    }
    for (const m of allLocal(doc, "MultiMedia")) {
      const id = m.getAttribute("ID");
      if (id == null) continue;
      const mf = firstLocal(m, "MediaFile");
      const rel = mf ? mf.textContent.trim() : "";
      if (!rel) continue;
      multimedia.set(id, { path: resolvePath(resBase, rel), format: m.getAttribute("Format") || "" });
    }
  }

  const dpCache = new Map();
  function resolveDrawParam(id, guard) {
    if (id == null) return {};
    if (dpCache.has(id)) return dpCache.get(id);
    guard = guard || new Set();
    if (guard.has(id)) return {};
    guard.add(id);
    const el = drawParams.get(id);
    if (!el) return {};
    let o = {};
    const rel = el.getAttribute("Relative");
    if (rel != null) o = Object.assign(o, resolveDrawParam(rel, guard));
    if (el.getAttribute("LineWidth") != null) { const lw = parseFloat(el.getAttribute("LineWidth")); if (!isNaN(lw)) o.lineWidth = lw; }
    const sc = firstLocal(el, "StrokeColor"); if (sc) { const c = parseColorEl(sc); if (c.color) o.strokeColor = c.color; if (c.opacity != null) o.strokeOpacity = c.opacity; }
    const fc = firstLocal(el, "FillColor"); if (fc) { const c = parseColorEl(fc); if (c.color) o.fillColor = c.color; if (c.opacity != null) o.fillOpacity = c.opacity; }
    dpCache.set(id, o);
    return o;
  }

  function fontFamily(fontId) { return cssFontFamily(fontId != null ? fonts.get(fontId) : null); }

  return { fonts, drawParams, multimedia, resolveDrawParam, fontFamily };
}

function parseXml(str) {
  if (!str) return null;
  const doc = new DOMParser().parseFromString(str, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) return null;
  return doc;
}

/* ---------------- object style resolution ---------------- */
function objectStyle(el, layerDp, ctx) {
  const dpId = el.getAttribute("DrawParam") || layerDp || null;
  let lineWidth = null, strokeColor = null, strokeOpacity = null, fillColor = null, fillOpacity = null;
  if (dpId) {
    const dp = ctx.resolveDrawParam(dpId);
    lineWidth = dp.lineWidth; strokeColor = dp.strokeColor; strokeOpacity = dp.strokeOpacity;
    fillColor = dp.fillColor; fillOpacity = dp.fillOpacity;
  }
  if (el.getAttribute("LineWidth") != null) { const lw = parseFloat(el.getAttribute("LineWidth")); if (!isNaN(lw)) lineWidth = lw; }
  const sc = firstLocal(el, "StrokeColor"); if (sc) { const c = parseColorEl(sc); if (c.color) strokeColor = c.color; if (c.opacity != null) strokeOpacity = c.opacity; }
  const fc = firstLocal(el, "FillColor"); if (fc) { const c = parseColorEl(fc); if (c.color) fillColor = c.color; if (c.opacity != null) fillOpacity = c.opacity; }
  return { lineWidth, strokeColor, strokeOpacity, fillColor, fillOpacity };
}

function getBox(el) {
  const b = el.getAttribute("Boundary");
  const p = nums(b);
  if (p.length < 4) return null;
  return { x: p[0], y: p[1], w: p[2], h: p[3] };
}

/* ---------------- object renderers -> SVG strings ---------------- */
function renderTextObject(el, layerDp, ctx) {
  const box = getBox(el);
  if (!box) return "";
  const tc = firstLocal(el, "TextCode");
  if (!tc) return "";
  const text = tc.textContent;
  if (text == null || text.length === 0) return "";
  const chars = Array.from(text);

  const X = parseFloat(tc.getAttribute("X") || "0") || 0;
  const Y = parseFloat(tc.getAttribute("Y") || "0") || 0;
  const dx = nums(tc.getAttribute("DeltaX"));
  const size = parseFloat(el.getAttribute("Size") || "0") || 0;
  const style = objectStyle(el, layerDp, ctx);
  const fill = style.fillColor || "rgb(0,0,0)";
  const family = ctx.fontFamily(el.getAttribute("Font"));

  // Per-character absolute X using DeltaX advances (faithful glyph positioning).
  const xs = [];
  let cx = X;
  for (let i = 0; i < chars.length; i++) {
    xs.push(cx);
    if (i < dx.length && !isNaN(dx[i])) cx += dx[i];
  }

  let attrs = 'font-family="' + escAttr(family) + '" font-size="' + size + '" fill="' + fill + '"';
  if (style.fillOpacity != null && style.fillOpacity < 1) attrs += ' fill-opacity="' + style.fillOpacity + '"';

  const ctm = el.getAttribute("CTM");
  if (ctm) {
    const m = nums(ctm);
    if (m.length === 6) {
      return '<g transform="translate(' + box.x + " " + box.y + ") matrix(" + m.join(" ") + ')">' +
        "<text " + attrs + ' x="' + xs.join(" ") + '" y="' + Y + '" xml:space="preserve">' + escXml(text) + "</text></g>";
    }
  }
  const xAbs = xs.map((v) => v + box.x);
  return "<text " + attrs + ' x="' + xAbs.join(" ") + '" y="' + (Y + box.y) + '" xml:space="preserve">' + escXml(text) + "</text>";
}

function renderPathObject(el, layerDp, ctx) {
  const box = getBox(el);
  if (!box) return "";
  const ad = firstLocal(el, "AbbreviatedData");
  if (!ad) return "";
  const d = ad.textContent.trim();
  if (!d) return "";
  const style = objectStyle(el, layerDp, ctx);
  const stroke = style.strokeColor || "none";
  const fill = style.fillColor || "none";
  const lw = style.lineWidth != null ? style.lineWidth : 0.25;

  let attrs = 'd="' + escAttr(d) + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + lw + '"';
  if (style.strokeOpacity != null && style.strokeOpacity < 1) attrs += ' stroke-opacity="' + style.strokeOpacity + '"';
  if (style.fillOpacity != null && style.fillOpacity < 1) attrs += ' fill-opacity="' + style.fillOpacity + '"';
  if (stroke !== "none") attrs += ' stroke-linecap="square" stroke-linejoin="miter"';

  const ctm = el.getAttribute("CTM");
  const m = ctm ? nums(ctm) : null;
  const tf = (m && m.length === 6)
    ? "translate(" + box.x + " " + box.y + ") matrix(" + m.join(" ") + ")"
    : "translate(" + box.x + " " + box.y + ")";
  return "<path " + attrs + ' transform="' + tf + '"/>';
}

function renderImageObject(el, ctx, resGetter) {
  const box = getBox(el);
  if (!box) return "";
  const rid = el.getAttribute("ResourceID");
  if (!rid) return "";
  const mm = ctx.multimedia.get(rid);
  if (!mm) return "";
  const src = resGetter(mm.path);
  if (!src) return "";

  const ctm = el.getAttribute("CTM");
  const m = ctm ? nums(ctm) : null;
  if (m && m.length === 6) {
    // CTM maps the unit image square; Boundary positions it on the page.
    return '<image href="' + src + '" x="0" y="0" width="1" height="1" preserveAspectRatio="none" ' +
      'transform="translate(' + box.x + " " + box.y + ") matrix(" + m.join(" ") + ')"/>';
  }
  return '<image href="' + src + '" x="' + box.x + '" y="' + box.y + '" width="' + box.w + '" height="' + box.h + '" preserveAspectRatio="none"/>';
}

function renderObject(el, layerDp, ctx, resGetter) {
  switch (ln(el)) {
    case "TextObject": return renderTextObject(el, layerDp, ctx);
    case "PathObject": return renderPathObject(el, layerDp, ctx);
    case "ImageObject": return renderImageObject(el, ctx, resGetter);
    case "CompositeObject": {
      // Composite objects reference another layer via ObjectID; render inline children if any.
      const out = [];
      for (const c of elemChildren(el)) { const s = renderObject(c, layerDp, ctx, resGetter); if (s) out.push(s); }
      return out.join("");
    }
    default: return "";
  }
}

/* Render the <ofd:Content> layers of a Page/Template document into `out`. */
function renderContentLayers(rootEl, out, ctx, resGetter) {
  const content = firstLocal(rootEl, "Content");
  if (!content) return;
  for (const layer of childrenLocal(content, "Layer")) {
    const layerDp = layer.getAttribute("DrawParam");
    for (const obj of elemChildren(layer)) {
      const s = renderObject(obj, layerDp, ctx, resGetter);
      if (s) out.push(s);
    }
  }
}

/* ---------------- package -> SVG pages ---------------- */
function convertOfd(pkg) {
  const files = pkg.files || {};
  const resources = pkg.resources || {};

  const lowerFiles = {}; for (const k in files) lowerFiles[k.toLowerCase()] = k;
  const lowerRes = {}; for (const k in resources) lowerRes[k.toLowerCase()] = k;
  const getFile = (p) => { if (!p) return null; if (files[p] != null) return files[p]; const k = lowerFiles[p.toLowerCase()]; return k ? files[k] : null; };
  const getRes = (p) => { if (!p) return null; if (resources[p] != null) return resources[p]; const k = lowerRes[p.toLowerCase()]; return k ? resources[k] : null; };

  const ofdXml = parseXml(getFile("OFD.xml"));
  if (!ofdXml) throw new Error("无法解析 OFD.xml 入口");
  const docRootRaw = firstTextLocal(ofdXml, "DocRoot");
  if (!docRootRaw) throw new Error("OFD.xml 中未找到 DocRoot");
  const docPath = normPath(docRootRaw);
  const docDir = dirOf(docPath);
  const docXml = parseXml(getFile(docPath));
  if (!docXml) throw new Error("无法解析 Document.xml: " + docPath);

  const root = docXml.documentElement;
  const commonData = firstLocal(root, "CommonData");

  // Default page area (mm).
  let W = 210, H = 297;
  const defBoxEl = commonData ? allLocal(commonData, "PhysicalBox")[0] : null;
  if (defBoxEl) { const p = nums(defBoxEl.textContent); if (p.length >= 4) { W = p[2]; H = p[3]; } }

  // Resources.
  const resPaths = [];
  if (commonData) {
    const pr = firstLocal(commonData, "PublicRes"); if (pr) resPaths.push(resolvePath(docDir, pr.textContent.trim()));
    const dr = firstLocal(commonData, "DocumentRes"); if (dr) resPaths.push(resolvePath(docDir, dr.textContent.trim()));
  }
  const ctx = buildContext(resPaths, docDir, getFile);

  // Templates by ID (from CommonData).
  const tplById = new Map();
  const tplDefault = [];
  if (commonData) {
    for (const tp of childrenLocal(commonData, "TemplatePage")) {
      const id = tp.getAttribute("ID");
      const path = resolvePath(docDir, tp.getAttribute("BaseLoc") || "");
      if (id != null && path) tplById.set(id, path);
      if (path) tplDefault.push({ path, z: tp.getAttribute("ZOrder") || "Background" });
    }
  }

  // Page list.
  const pagesEl = firstLocal(root, "Pages");
  const pageRefs = pagesEl ? childrenLocal(pagesEl, "Page") : [];

  const svgs = [];
  for (const pref of pageRefs) {
    const pagePath = resolvePath(docDir, pref.getAttribute("BaseLoc") || "");
    const pageTxt = getFile(pagePath);
    if (!pageTxt) continue;
    const pageXml = parseXml(pageTxt);
    if (!pageXml) continue;
    const pageRoot = pageXml.documentElement;

    // Page may override the area.
    let pw = W, ph = H;
    const area = firstLocal(pageRoot, "Area");
    if (area) { const pb = allLocal(area, "PhysicalBox")[0]; if (pb) { const p = nums(pb.textContent); if (p.length >= 4) { pw = p[2]; ph = p[3]; } } }

    // Templates referenced by this page (else fall back to CommonData defaults).
    let refs = childrenLocal(pageRoot, "Template").map((t) => ({
      path: tplById.get(t.getAttribute("TemplateID")), z: t.getAttribute("ZOrder") || "Background",
    })).filter((r) => r.path);
    if (!refs.length) refs = tplDefault.slice();

    const bg = [], fg = [];
    for (const r of refs) (r.z === "Foreground" ? fg : bg).push(r.path);

    const out = [];
    out.push('<rect x="0" y="0" width="' + pw + '" height="' + ph + '" fill="#ffffff"/>');
    for (const p of bg) { const d = parseXml(getFile(p)); if (d) renderContentLayers(d.documentElement, out, ctx, getRes); }
    renderContentLayers(pageRoot, out, ctx, getRes);
    for (const p of fg) { const d = parseXml(getFile(p)); if (d) renderContentLayers(d.documentElement, out, ctx, getRes); }

    svgs.push(
      '<svg class="ofd-page" xmlns="' + SVG_NS + '" xmlns:xlink="http://www.w3.org/1999/xlink" ' +
      'viewBox="0 0 ' + pw + " " + ph + '" width="' + pw + 'mm" height="' + ph + 'mm">' + out.join("") + "</svg>"
    );
  }

  if (!svgs.length) throw new Error("文档中没有可渲染的页面");
  return { html: svgs.join(""), pageCount: svgs.length, width: W, height: H };
}

/* ---------------- App / UI wiring ---------------- */
const tauri = window.__TAURI__;
const invoke = tauri && tauri.core ? tauri.core.invoke : null;

const els = {
  btnOpen: document.getElementById("btn-open"),
  btnOpen2: document.getElementById("btn-open-2"),
  btnPrint: document.getElementById("btn-print"),
  fileInput: document.getElementById("file-input"),
  docTitle: document.getElementById("doc-title"),
  welcome: document.getElementById("welcome"),
  pageWrap: document.getElementById("page-wrap"),
  page: document.getElementById("page"),
  viewport: document.getElementById("viewport"),
  dropOverlay: document.getElementById("drop-overlay"),
  loading: document.getElementById("loading"),
  statusText: document.getElementById("status-text"),
  statusbar: document.getElementById("statusbar"),
  zoomIn: document.getElementById("btn-zoom-in"),
  zoomOut: document.getElementById("btn-zoom-out"),
  zoomReset: document.getElementById("btn-zoom-reset"),
  zoomLabel: document.getElementById("zoom-label"),
};

let zoom = 1;

function setStatus(msg, isError) {
  els.statusText.textContent = msg;
  els.statusbar.classList.toggle("error", !!isError);
}
function applyZoom() {
  els.page.style.transform = "scale(" + zoom + ")";
  els.zoomLabel.textContent = Math.round(zoom * 100) + "%";
}
function setDocControls(enabled) {
  els.btnPrint.disabled = !enabled;
  els.zoomIn.disabled = !enabled;
  els.zoomOut.disabled = !enabled;
  els.zoomReset.disabled = !enabled;
}
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(bin);
}
function errMessage(err) {
  if (!err) return "未知错误";
  if (typeof err === "string") return err;
  if (err.message) return err.message;
  try { return JSON.stringify(err); } catch (e) { return String(err); }
}

function showDocument(pkg, fallbackName) {
  els.loading.hidden = false;
  setStatus("正在解析文档…");
  setTimeout(() => {
    try {
      const res = convertOfd(pkg);
      els.page.innerHTML = res.html;
      const name = fallbackName || "OFD 文档";
      els.docTitle.textContent = name + "（" + res.pageCount + " 页）";
      document.title = name + " — OFD Reader";
      els.welcome.hidden = true;
      els.pageWrap.hidden = false;
      setDocControls(true);
      zoom = 1; applyZoom();
      els.viewport.scrollTop = 0;
      setStatus("已打开：" + name + "，共 " + res.pageCount + " 页");
    } catch (err) {
      console.error(err);
      setStatus("打开失败：" + errMessage(err), true);
    } finally {
      els.loading.hidden = true;
    }
  }, 30);
}

async function openFileObject(file) {
  if (!file) return;
  try {
    els.loading.hidden = false;
    setStatus("正在读取：" + file.name);
    const buf = await file.arrayBuffer();
    const pkg = await invoke("open_ofd", { bytesB64: bufToBase64(buf) });
    showDocument(pkg, file.name);
  } catch (err) {
    els.loading.hidden = true;
    setStatus("打开失败：" + errMessage(err), true);
  }
}

async function openPath(path) {
  if (!path) return;
  try {
    els.loading.hidden = false;
    setStatus("正在读取：" + path);
    const pkg = await invoke("open_ofd_path", { path });
    showDocument(pkg, path.split(/[\\/]/).pop());
  } catch (err) {
    els.loading.hidden = true;
    setStatus("打开失败：" + errMessage(err), true);
  }
}

const OFD_EXTENSIONS = ["ofd"];
async function pickAndOpen() {
  const dlg = tauri && tauri.dialog;
  if (dlg && typeof dlg.open === "function") {
    try {
      const selected = await dlg.open({
        multiple: false,
        title: "打开 OFD 文档",
        filters: [
          { name: "OFD 版式文档", extensions: OFD_EXTENSIONS },
          { name: "所有文件", extensions: ["*"] },
        ],
      });
      if (selected) await openPath(selected);
      return;
    } catch (e) { console.warn("native dialog failed, falling back to input", e); }
  }
  els.fileInput.click();
}

/* Events */
els.btnOpen.addEventListener("click", () => pickAndOpen());
els.btnOpen2.addEventListener("click", () => pickAndOpen());
els.fileInput.addEventListener("change", () => {
  const f = els.fileInput.files && els.fileInput.files[0];
  if (f) openFileObject(f);
  els.fileInput.value = "";
});
els.btnPrint.addEventListener("click", () => window.print());
els.zoomIn.addEventListener("click", () => { zoom = Math.min(zoom + 0.1, 4); applyZoom(); });
els.zoomOut.addEventListener("click", () => { zoom = Math.max(zoom - 0.1, 0.2); applyZoom(); });
els.zoomReset.addEventListener("click", () => { zoom = 1; applyZoom(); });

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && (e.key === "p" || e.key === "P")) { e.preventDefault(); if (!els.btnPrint.disabled) window.print(); }
  else if (mod && (e.key === "o" || e.key === "O")) { e.preventDefault(); pickAndOpen(); }
  else if (mod && (e.key === "+" || e.key === "=")) { e.preventDefault(); zoom = Math.min(zoom + 0.1, 4); applyZoom(); }
  else if (mod && e.key === "-") { e.preventDefault(); zoom = Math.max(zoom - 0.1, 0.2); applyZoom(); }
  else if (mod && e.key === "0") { e.preventDefault(); zoom = 1; applyZoom(); }
});

async function setupDragDrop() {
  try {
    if (!tauri || !tauri.window) return;
    const win = tauri.window.getCurrentWindow();
    await win.onDragDropEvent((event) => {
      const p = event.payload || {};
      if (p.type === "enter" || p.type === "over") els.dropOverlay.hidden = false;
      else if (p.type === "leave") els.dropOverlay.hidden = true;
      else if (p.type === "drop") {
        els.dropOverlay.hidden = true;
        const paths = p.paths || [];
        if (paths.length) openPath(paths[0]);
      }
    });
  } catch (e) { console.warn("drag-drop unavailable", e); }
}

["dragenter", "dragover"].forEach((t) => window.addEventListener(t, (e) => { e.preventDefault(); }));
window.addEventListener("drop", (e) => {
  if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
    e.preventDefault();
    openFileObject(e.dataTransfer.files[0]);
  }
});

function init() {
  if (!invoke) {
    setStatus("未在 Tauri 环境中运行", true);
    els.btnOpen.disabled = true;
    els.btnOpen2.disabled = true;
    return;
  }
  setupDragDrop();
  setStatus("就绪 — 打开或拖入一个 OFD 文件");
}

init();
