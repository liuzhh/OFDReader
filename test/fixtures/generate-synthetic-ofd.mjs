// Builds a fully synthetic OFD (GB/T 33190) fixture tree for the renderer test.
//
// Every value below is invented - no real invoice, passenger, or seal is used,
// so the output is safe to publish and is regenerated on each `npm test` run.
// The document mimics the layout of a China Tax air-ticket e-invoice
// (`电子发票（航空运输电子客票行程单）`) closely enough to exercise every code
// path in ui/app.js: template path objects, per-glyph text placement, font and
// DrawParam resolution, and image resources.
//
// Usage: node test/fixtures/generate-synthetic-ofd.mjs [--zip]
//   --zip  also writes ../demo-synthetic.ofd (a real .ofd package) for manual
//          smoke-testing by dragging it onto the app.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "ofd");

/* ------------------------------------------------------------------ */
/* Synthetic document data - all values are placeholders.              */
/* ------------------------------------------------------------------ */
const DOC = {
  docId: "00000000000000000000000000000001",
  creationDate: "2026-01-15",
  // Deliberately non-identifying: a 20-digit sequence of leading zeros.
  invoiceNumber: "00000000000000000001",
  eTicketNumber: "0000000000001",
  checkCode: "0000",
  passengerName: "示例旅客",
  idNumber: "110101********0000",
  endorsement: "示例签注",
  departure: "北京 首都",
  arrival: "上海 虹桥",
  carrier: "示例航空",
  flight: "CA0000",
  bookingClass: "Y",
  carrierDate: "2026-01-10",
  departureTime: "09:00",
  fareBasis: "Y/00",
  baggage: "20K",
  fare: 500.0,
  fuelSurcharge: 60.0,
  vatRate: 9,
  vatAmount: 50.4,
  fund: 50.0,
  insurance: 0.0,
  total: 660.4,
  issuer: "示例航空服务有限公司",
  purchaser: "示例科技有限公司",
  purchaserCode: "910000000000000000",
  seller: "示例航空有限责任公司",
  prompt: "示例提示信息",
  issueStatus: "正常",
  domestic: "国内",
  agentCode: "DEMO00/00000000",
};

const money = (n) => "CNY " + n.toFixed(2);
const Q = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ------------------------------------------------------------------ */
/* Minimal PNG encoder (8-bit RGB, no interlacing).                    */
/* ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode a width x height RGB image; `pixel(x, y)` returns [r, g, b]. */
function encodePng(width, height, pixel) {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A red circular seal placeholder with a transparent-looking white core. */
function makeSealPng(size = 160) {
  const c = (size - 1) / 2;
  const outer = size * 0.46;
  const inner = size * 0.34;
  return encodePng(size, size, (x, y) => {
    const d = Math.hypot(x - c, y - c);
    const onRing = d <= outer && d >= inner;
    const onStar = d <= size * 0.08;
    const onSpoke = d > inner && d < outer && (Math.abs(x - c) < size * 0.02 || Math.abs(y - c) < size * 0.02);
    if (onRing && !onSpoke) return [200, 30, 30];
    if (onStar) return [200, 30, 30];
    return [255, 255, 255];
  });
}

/** A QR-like placeholder: deterministic pseudo-random black modules. */
function makeQrPng(size = 120, modules = 21) {
  const cell = size / modules;
  const dark = (mx, my) => {
    const h = (mx * 73856093) ^ (my * 19349663);
    return ((h >>> 3) & 1) === 1;
  };
  const finder = (mx, my, ox, oy) => {
    const dx = mx - ox, dy = my - oy;
    if (dx < 0 || dy < 0 || dx > 6 || dy > 6) return null;
    const ring = Math.max(Math.abs(dx - 3), Math.abs(dy - 3));
    return ring === 3 || ring <= 1;
  };
  const isDark = (mx, my) => {
    for (const [ox, oy] of [[0, 0], [modules - 7, 0], [0, modules - 7]]) {
      const f = finder(mx, my, ox, oy);
      if (f !== null) return f;
    }
    return dark(mx, my);
  };
  // Quiet zone of 2 modules keeps the code scannable-looking.
  const quiet = 2;
  const total = modules + quiet * 2;
  const scale = size / total;
  return encodePng(size, size, (x, y) => {
    const mx = Math.floor(x / scale) - quiet;
    const my = Math.floor(y / scale) - quiet;
    if (mx < 0 || my < 0 || mx >= modules || my >= modules) return [255, 255, 255];
    return isDark(mx, my) ? [0, 0, 0] : [255, 255, 255];
  });
}

/* ------------------------------------------------------------------ */
/* XML parts                                                           */
/* ------------------------------------------------------------------ */
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" ?>\n';
const NS = 'xmlns:ofd="http://www.ofdspec.org/2016"';

/** A text object: Boundary + Font/Size + optional inline fill + TextCode. */
function textObject(id, { box, font, size, text, fill, ctm }) {
  const chars = Array.from(text);
  // Half-width advance for ASCII, full-width for CJK - mirrors how the real
  // generator spaces glyphs.
  const adv = chars.map((ch) => (ch.charCodeAt(0) < 0x2e80 ? size / 2 : size));
  const width = adv.reduce((a, b) => a + b, 0);
  const fillEl = fill ? `\n                <ofd:FillColor Value="${fill}"/>` : "";
  const ctmAttr = ctm ? ` CTM="${ctm}"` : "";
  return `            <ofd:TextObject ID="${id}"${ctmAttr} Boundary="${box} ${width.toFixed(2)} ${(size * 1.2).toFixed(2)}" Font="${font}" Size="${size}">` +
    `${fillEl}\n                <ofd:TextCode X="0" Y="${(size * 0.85).toFixed(4)}" DeltaX="${adv.map((v) => v.toFixed(4)).join(" ")}">${Q(text)}</ofd:TextCode>\n` +
    `            </ofd:TextObject>`;
}

/** A straight or closed path object in the boundary's local coordinates. */
function pathObject(id, box, d) {
  return `            <ofd:PathObject ID="${id}" Boundary="${box}">\n` +
    `                <ofd:AbbreviatedData>${d}</ofd:AbbreviatedData>\n` +
    `            </ofd:PathObject>`;
}

function buildOfdXml() {
  return XML_HEAD +
    `<ofd:OFD Version="1.1" DocType="OFD" ${NS}>\n` +
    `    <ofd:DocBody>\n` +
    `        <ofd:DocInfo>\n` +
    `            <ofd:DocID>${DOC.docId}</ofd:DocID>\n` +
    `            <ofd:Author>ofd-reader test fixture</ofd:Author>\n` +
    `            <ofd:CreationDate>${DOC.creationDate}</ofd:CreationDate>\n` +
    `            <ofd:ModDate>${DOC.creationDate}</ofd:ModDate>\n` +
    `        </ofd:DocInfo>\n` +
    `        <ofd:DocRoot>/Doc_0/Document.xml</ofd:DocRoot>\n` +
    `        <ofd:Signatures>/Doc_0/Signs/Signatures.xml</ofd:Signatures>\n` +
    `    </ofd:DocBody>\n` +
    `</ofd:OFD>\n`;
}

function buildDocumentXml() {
  return XML_HEAD +
    `<ofd:Document ${NS}>\n` +
    `    <ofd:CommonData>\n` +
    `        <ofd:MaxUnitID>6000</ofd:MaxUnitID>\n` +
    `        <ofd:PageArea>\n` +
    `            <ofd:PhysicalBox>0 0 230 133.5</ofd:PhysicalBox>\n` +
    `        </ofd:PageArea>\n` +
    `        <ofd:PublicRes>PublicRes.xml</ofd:PublicRes>\n` +
    `        <ofd:DocumentRes>DocumentRes.xml</ofd:DocumentRes>\n` +
    `        <ofd:TemplatePage ID="1" BaseLoc="Tpls/Tpl_0/Content.xml" ZOrder="Background"/>\n` +
    `    </ofd:CommonData>\n` +
    `    <ofd:Pages>\n` +
    `        <ofd:Page ID="6003" BaseLoc="Pages/Page_0/Content.xml"/>\n` +
    `    </ofd:Pages>\n` +
    `    <ofd:Annotations>Annots/Annotations.xml</ofd:Annotations>\n` +
    `    <ofd:Attachments>Attachs/Attachments.xml</ofd:Attachments>\n` +
    `</ofd:Document>\n`;
}

function buildPublicResXml() {
  return XML_HEAD +
    `<ofd:Res ${NS} BaseLoc="Res">\n` +
    `    <ofd:DrawParams>\n` +
    `        <ofd:DrawParam ID="1" LineWidth="0.25">\n` +
    `            <ofd:StrokeColor Value="0 0 0"/>\n` +
    `        </ofd:DrawParam>\n` +
    `        <ofd:DrawParam ID="2" Relative="3">\n` +
    `            <ofd:FillColor Value="0 0 0"/>\n` +
    `        </ofd:DrawParam>\n` +
    `        <ofd:DrawParam ID="3" LineWidth="0.25">\n` +
    `            <ofd:StrokeColor Value="156 74 9"/>\n` +
    `        </ofd:DrawParam>\n` +
    `        <ofd:DrawParam ID="4" Relative="3">\n` +
    `            <ofd:FillColor Value="156 74 9"/>\n` +
    `        </ofd:DrawParam>\n` +
    `    </ofd:DrawParams>\n` +
    `    <ofd:Fonts>\n` +
    `        <ofd:Font ID="5" FontName="楷体" FamilyName="楷体"/>\n` +
    `        <ofd:Font ID="6" FontName="宋体"/>\n` +
    `        <ofd:Font ID="7" FontName="Courier New"/>\n` +
    `        <ofd:Font ID="8" FontName="黑体"/>\n` +
    `        <ofd:Font ID="9" FontName="Times New Roman"/>\n` +
    `    </ofd:Fonts>\n` +
    `</ofd:Res>\n`;
}

function buildDocumentResXml() {
  return XML_HEAD +
    `<ofd:Res ${NS} BaseLoc="Res">\n` +
    `    <ofd:MultiMedias>\n` +
    `        <ofd:MultiMedia ID="5500" Type="Image" Format="PNG">\n` +
    `            <ofd:MediaFile>stamp_demo.png</ofd:MediaFile>\n` +
    `        </ofd:MultiMedia>\n` +
    `        <ofd:MultiMedia ID="5501" Type="Image" Format="PNG">\n` +
    `            <ofd:MediaFile>qrcode_demo.png</ofd:MediaFile>\n` +
    `        </ofd:MultiMedia>\n` +
    `    </ofd:MultiMedias>\n` +
    `</ofd:Res>\n`;
}

/**
 * Background template: a bordered table grid (PathObjects on DrawParam 1) plus
 * the static field labels (TextObjects on DrawParam 4, inheriting its brown
 * fill through the DrawParam `Relative` chain).
 */
function buildTemplateXml() {
  const x0 = 15, x1 = 213.2, y0 = 32.6, y1 = 117.6;
  const rows = [43.1, 49.6, 83.6, 92.0, 100.5, 109.0];
  const cols = [58.4, 71.1, 85.9, 97.6, 113, 127, 167.6, 184.1, 200.6];
  const paths = [];
  let id = 7;
  const r1 = (v) => String(Math.round(v * 10) / 10);
  const line = (x, y, w, h) => paths.push(pathObject(id++, `${x} ${y} ${r1(w)} ${r1(h)}`, `M 0 0 L ${r1(w)} ${r1(h)}`));

  // Outer frame (closed path) then the inner row/column separators.
  const fw = r1(x1 - x0), fh = r1(y1 - y0);
  paths.push(pathObject(id++, `${x0} ${y0} ${fw} ${fh}`,
    `M 0 0 L ${fw} 0 L ${fw} ${fh} L 0 ${fh} Z`));
  for (const y of rows) line(x0, y, x1 - x0, 0);
  for (const x of cols) line(x, y0 + 0.1, 0, y1 - y0 - 0.2);

  const labels = [
    [70, 15, 8, 4.7614, "电子发票（航空运输电子客票行程单）"],
    [16, 32.6, 5, 2.998, "旅客姓名"],
    [64, 32.6, 5, 2.998, "有效身份证件号码"],
    [127.3, 32.6, 5, 2.998, "签注"],
    [16, 44.25, 5, 2.998, "出发地"],
    [60.52, 44.25, 5, 2.998, "承运人"],
    [74.87, 44.25, 5, 2.998, "航班号"],
    [86.31, 44.25, 5, 2.998, "座位等级"],
    [102.48, 44.25, 5, 2.998, "日期"],
    [117.18, 44.25, 5, 2.998, "时间"],
    [134.7, 44.25, 5, 2.998, "客票级别/客票类别"],
    [167.85, 44.25, 5, 2.998, "客票生效日期"],
    [184.35, 44.25, 5, 2.998, "有效截止日期"],
    [201.21, 44.25, 5, 2.998, "免费行李"],
    [16, 83.6, 5, 2.998, "票价"],
    [80.6, 83.6, 5, 2.998, "燃油附加费"],
    [102.4, 83.6, 5, 2.998, "增值税税率"],
    [118.1, 83.6, 5, 2.998, "增值税税额"],
    [140.1, 83.6, 5, 2.998, "民航发展基金"],
    [162.1, 83.6, 5, 2.998, "其他税费"],
    [184.1, 83.6, 5, 2.998, "合计金额"],
    [16, 92.0, 5, 2.998, "电子客票号码"],
    [71.1, 92.0, 5, 2.998, "验证码"],
    [97.6, 92.0, 5, 2.998, "提示信息"],
    [184.1, 92.0, 5, 2.998, "保险费"],
    [16, 100.5, 5, 2.998, "销售方代码"],
    [86.1, 100.5, 5, 2.998, "销售方名称"],
    [184.1, 100.5, 5, 2.998, "填开日期"],
    [16, 109.0, 5, 2.998, "购买方名称"],
    [158, 109.0, 5, 2.998, "统一社会信用代码"],
  ];
  let tid = 34;
  const texts = labels.map(([x, y, font, size, text]) => textObject(tid++, {
    box: `${x} ${y}`, font, size, text,
    // Reset the inherited stroke to fully transparent, as the real generator does.
    fill: null,
  }).replace("<ofd:TextCode", '<ofd:StrokeColor Value="0 0 0" Alpha="0"/>\n                <ofd:TextCode'));

  return XML_HEAD +
    `<ofd:Page ${NS}>\n` +
    `    <ofd:Content>\n` +
    `        <ofd:Layer ID="6" DrawParam="1">\n` +
    paths.join("\n") + "\n" +
    `        </ofd:Layer>\n` +
    `        <ofd:Layer ID="33" DrawParam="4">\n` +
    texts.join("\n") + "\n" +
    `        </ofd:Layer>\n` +
    `    </ofd:Content>\n` +
    `</ofd:Page>\n`;
}

/** The variable page data: invoice field values plus the seal and QR images. */
function buildPageXml() {
  const objs = [
    `            <ofd:ImageObject ID="999" CTM="12 0 0 12 0 0" Boundary="150 20 12 12" ResourceID="5500"/>`,
    `            <ofd:ImageObject ID="998" CTM="20 0 0 20 0 0" Boundary="94 9.5 20 20" ResourceID="5501"/>`,
    textObject(1011, { box: "16.3 35.1", font: 6, size: 2.998, text: DOC.passengerName }),
    textObject(1012, { box: "64.5 35.1", font: 7, size: 2.998, text: DOC.idNumber }),
    textObject(1013, { box: "128.5 35.1", font: 6, size: 2.998, text: DOC.endorsement }),
    textObject(1014, { box: "177 27.4", font: 6, size: 2.998, text: DOC.invoiceNumber }),
    textObject(1032, { box: "35.1 19.5", font: 6, size: 2.998, text: DOC.domestic }),
    textObject(1035, { box: "16 20", font: 5, size: 3.0, text: "国内国际标识：", fill: "156 74 9" }),
    textObject(1036, { box: "177.5 19.5", font: 6, size: 2.998, text: DOC.issueStatus }),
    textObject(1000, { box: "20 51.3", font: 6, size: 2.998, text: DOC.departure }),
    textObject(1001, { box: "58.5 51.3", font: 6, size: 2.998, text: DOC.carrier }),
    textObject(1002, { box: "71.3 51.3", font: 7, size: 2.998, text: DOC.flight }),
    textObject(1003, { box: "86.31 51.3", font: 6, size: 2.998, text: DOC.bookingClass }),
    textObject(1004, { box: "97.9 51.3", font: 6, size: 1.9399, text: DOC.carrierDate }),
    textObject(1005, { box: "113.3 51.3", font: 7, size: 2.998, text: DOC.departureTime }),
    textObject(1006, { box: "127.6 51.3", font: 7, size: 2.998, text: DOC.fareBasis }),
    textObject(1009, { box: "201 51.3", font: 7, size: 2.998, text: DOC.baggage }),
    textObject(1020, { box: "20 59.7", font: 6, size: 2.998, text: DOC.arrival }),
    textObject(1015, { box: "58.5 86.0", font: 7, size: 2.998, text: money(DOC.fare) }),
    textObject(1016, { box: "80.5 86.0", font: 7, size: 2.998, text: money(DOC.fuelSurcharge) }),
    textObject(1017, { box: "103 86.0", font: 7, size: 2.998, text: `${DOC.vatRate}%` }),
    textObject(1018, { box: "118.5 86.0", font: 7, size: 2.998, text: money(DOC.vatAmount) }),
    textObject(1019, { box: "140.5 86.0", font: 7, size: 2.998, text: money(DOC.fund) }),
    textObject(1021, { box: "162.5 86.0", font: 7, size: 2.998, text: money(DOC.insurance) }),
    textObject(1022, { box: "184.5 86.0", font: 7, size: 2.998, text: money(DOC.total) }),
    textObject(1023, { box: "34 92.0", font: 7, size: 2.998, text: DOC.eTicketNumber }),
    textObject(1024, { box: "83.6 92.0", font: 7, size: 2.998, text: DOC.checkCode }),
    textObject(1025, { box: "111.1 92.0", font: 6, size: 2.998, text: DOC.prompt }),
    textObject(1026, { box: "194.3 92.0", font: 7, size: 2.998, text: DOC.insurance.toFixed(2) }),
    textObject(1027, { box: "34 100.35", font: 7, size: 2.998, text: DOC.agentCode }),
    textObject(1028, { box: "86.1 100.35", font: 6, size: 2.998, text: DOC.issuer }),
    textObject(1029, { box: "184.1 100.35", font: 6, size: 2.6452, text: DOC.creationDate }),
    textObject(1030, { box: "31 110.0", font: 6, size: 2.998, text: DOC.purchaser }),
    textObject(1031, { box: "158 109.5", font: 7, size: 2.998, text: DOC.purchaserCode }),
    textObject(1033, { box: "31 118.5", font: 6, size: 2.998, text: DOC.seller }),
  ];

  return XML_HEAD +
    `<ofd:Page ${NS}>\n` +
    `    <ofd:Area>\n` +
    `        <ofd:PhysicalBox>0 0 230 133.5</ofd:PhysicalBox>\n` +
    `    </ofd:Area>\n` +
    `    <ofd:Template TemplateID="1" ZOrder="Background"/>\n` +
    `    <ofd:Content>\n` +
    `        <ofd:Layer Type="Body">\n` +
    objs.join("\n") + "\n" +
    `        </ofd:Layer>\n` +
    `    </ofd:Content>\n` +
    `</ofd:Page>\n`;
}

function buildAnnotationsXml() {
  return XML_HEAD +
    `<ofd:Annotations ${NS}>\n` +
    `    <ofd:Page PageID="1">\n` +
    `        <ofd:FileLoc>Page_0/Annotation.xml</ofd:FileLoc>\n` +
    `    </ofd:Page>\n` +
    `</ofd:Annotations>\n`;
}

function buildAnnotationXml() {
  return XML_HEAD +
    `<ofd:PageAnnot ${NS}>\n` +
    `    <ofd:Annot Type="Stamp" ID="7000" Subtype="SignatureInFile">\n` +
    `        <Parameters>\n` +
    `            <Parameter Name="fp.NativeSign">synthetic_fixture</Parameter>\n` +
    `        </Parameters>\n` +
    `        <ofd:Appearance Boundary="4.5 104 115 20"/>\n` +
    `    </ofd:Annot>\n` +
    `</ofd:PageAnnot>\n`;
}

const ATTACHMENT_NAME = "atr_issuer_demo.xml";

function buildAttachmentsXml() {
  return XML_HEAD +
    `<ofd:Attachments ${NS}>\n` +
    `    <ofd:Attachment ID="5000" Name="atr_issuer_demo" Format="xml" CreationDate="${DOC.creationDate}T09:00:00" ModDate="${DOC.creationDate}T09:00:00" Size="4" Visible="true">\n` +
    `        <ofd:FileLoc>${ATTACHMENT_NAME}</ofd:FileLoc>\n` +
    `    </ofd:Attachment>\n` +
    `</ofd:Attachments>\n`;
}

/** XBRL attachment, following the China Tax air-ticket taxonomy shape. */
function buildAttachmentXml() {
  const ctx = ' contextRef="C1"';
  const t = (tag, value) => `  <atr:${tag}${ctx}>${Q(value)}</atr:${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>

<!-- Synthetic test fixture generated by test/fixtures/generate-synthetic-ofd.mjs -->
<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:link="http://www.xbrl.org/2003/linkbase" xmlns:atr="http://xbrl.mof.gov.cn/taxonomy/2021-11-30/atr" xmlns:iso4217="http://www.xbrl.org/2003/iso4217" xmlns:xlink="http://www.w3.org/1999/xlink">
  <link:schemaRef xlink:type="simple" xlink:href="atr_issuer_entry_point_2021-11-30.xsd"/>
  <xbrli:context id="C1">
    <xbrli:entity>
      <xbrli:identifier scheme="http://xbrl.mof.gov.cn">${Q(DOC.issuer)}</xbrli:identifier>
    </xbrli:entity>
    <xbrli:period>
      <xbrli:instant>${DOC.creationDate}</xbrli:instant>
    </xbrli:period>
  </xbrli:context>
  <xbrli:unit id="U1">
    <xbrli:measure>iso4217:CNY</xbrli:measure>
  </xbrli:unit>
${t("PassengerName", DOC.passengerName)}
${t("ValidIdNumber", DOC.idNumber)}
${t("Endorsement", DOC.endorsement)}
${t("ElectronicInvoiceAirTransportReceiptNumber", DOC.invoiceNumber)}
${t("QrCode", `01,61,,${DOC.invoiceNumber},${DOC.total.toFixed(2)},${DOC.creationDate.replace(/-/g, "")},,${DOC.checkCode}`)}
  <atr:DetailInformationOfAirTicketTuple>
${t("DepartureStation", DOC.departure)}
${t("DestinationStation", DOC.arrival)}
${t("FlightSegment", "1")}
${t("Carrier", DOC.carrier)}
${t("Flight", DOC.flight)}
${t("Class", DOC.bookingClass)}
${t("CarrierDate", DOC.carrierDate)}
${t("DepartureTime", DOC.departureTime)}
${t("FareBasis", DOC.fareBasis)}
${t("FreeBaggageAllowance", DOC.baggage)}
  </atr:DetailInformationOfAirTicketTuple>
  <atr:Fare decimals="2"${ctx} unitRef="U1">${DOC.fare.toFixed(2)}</atr:Fare>
  <atr:FuelSurcharge decimals="2"${ctx} unitRef="U1">${DOC.fuelSurcharge.toFixed(2)}</atr:FuelSurcharge>
  <atr:VatRate decimals="2"${ctx} unitRef="U1">${(DOC.vatRate / 100).toFixed(2)}</atr:VatRate>
  <atr:VatTaxAmount decimals="2"${ctx} unitRef="U1">${DOC.vatAmount.toFixed(2)}</atr:VatTaxAmount>
  <atr:CivilAviationDevelopmentFund decimals="2"${ctx} unitRef="U1">${DOC.fund.toFixed(2)}</atr:CivilAviationDevelopmentFund>
  <atr:OtherTaxes decimals="2"${ctx} unitRef="U1">${DOC.insurance.toFixed(2)}</atr:OtherTaxes>
  <atr:TotalAmount decimals="2"${ctx} unitRef="U1">${DOC.total.toFixed(2)}</atr:TotalAmount>
${t("ETicketNumber", DOC.eTicketNumber)}
${t("VerificationCode", DOC.checkCode)}
${t("PromptInformation", DOC.prompt)}
${t("Insurance", DOC.insurance.toFixed(2))}
${t("AgentCode", DOC.agentCode)}
${t("IssueParty", DOC.issuer)}
${t("IssueDate", DOC.creationDate)}
${t("IssuingStatus", DOC.issueStatus)}
${t("MarkingOfDomesticOrInternational", DOC.domestic)}
${t("NameOfPurchaser", DOC.purchaser)}
${t("NameOfSeller", DOC.seller)}
${t("UnifiedSocialCreditCodeOfPurchaser", DOC.purchaserCode)}
</xbrli:xbrl>
`;
}

function buildSignaturesXml() {
  return XML_HEAD +
    `<ofd:Signatures ${NS}>\n` +
    `    <ofd:MaxSignId>1</ofd:MaxSignId>\n` +
    `    <ofd:Signature ID="1" Type="Sign" BaseLoc="/Doc_0/Signs/Sign_0/Signature.xml"/>\n` +
    `</ofd:Signatures>\n`;
}

/**
 * Signature descriptor. The content digests are real SHA-256 values computed
 * over the generated parts, but this is NOT a valid OFD signature: no SM3
 * digest and no SignedValue PKCS#7 payload are produced.
 */
function buildSignatureXml(parts) {
  const refs = [
    "/Doc_0/Tpls/Tpl_0/Content.xml",
    "/Doc_0/Pages/Page_0/Content.xml",
    "/Doc_0/DocumentRes.xml",
    "/Doc_0/PublicRes.xml",
    "/Doc_0/Document.xml",
    "/OFD.xml",
    "/Doc_0/Res/stamp_demo.png",
    "/Doc_0/Res/qrcode_demo.png",
    "/Doc_0/Attachs/Attachments.xml",
    `/Doc_0/Attachs/${ATTACHMENT_NAME}`,
    "/Doc_0/Annots/Annotations.xml",
    "/Doc_0/Annots/Page_0/Annotation.xml",
  ];
  const body = refs.map((ref) => {
    const data = parts.get(ref.slice(1));
    const digest = crypto.createHash("sha256").update(data).digest("base64");
    return `            <ofd:Reference FileRef="${ref}">\n` +
      `                <ofd:CheckValue>${digest}</ofd:CheckValue>\n` +
      `            </ofd:Reference>`;
  }).join("\n");

  return XML_HEAD +
    `<ofd:Signature ${NS}>\n` +
    `    <ofd:SignedInfo>\n` +
    `        <ofd:Provider ProviderName="SYNTHETIC" Version="1.0" Company="ofd-reader fixture"/>\n` +
    `        <ofd:SignatureMethod>1.2.156.10197.1.501</ofd:SignatureMethod>\n` +
    `        <ofd:SignatureDateTime>${DOC.creationDate.replace(/-/g, "")}090000Z</ofd:SignatureDateTime>\n` +
    `        <ofd:References CheckMethod="1.2.156.10197.1.401">\n` +
    body + "\n" +
    `        </ofd:References>\n` +
    `        <ofd:StampAnnot PageRef="6003" ID="2" Boundary="4.5 104 115 20"/>\n` +
    `    </ofd:SignedInfo>\n` +
    `    <ofd:SignedValue>/Doc_0/Signs/Sign_0/SignedValue.dat</ofd:SignedValue>\n` +
    `</ofd:Signature>\n`;
}

/* ------------------------------------------------------------------ */
/* Minimal ZIP writer (store + deflate), used for the --zip output.    */
/* ------------------------------------------------------------------ */
function dosDateTime(date) {
  const time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)) & 0xffff;
  const day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xffff;
  return { time, day };
}

function writeZip(entries) {
  const { time, day } = dosDateTime(new Date(Date.UTC(2026, 0, 15, 9, 0, 0)));
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const payload = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(day, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

/* ------------------------------------------------------------------ */
/* Build                                                              */
/* ------------------------------------------------------------------ */
const parts = new Map(); // package path (no leading slash) -> Buffer

parts.set("OFD.xml", Buffer.from(buildOfdXml(), "utf8"));
parts.set("Doc_0/Document.xml", Buffer.from(buildDocumentXml(), "utf8"));
parts.set("Doc_0/PublicRes.xml", Buffer.from(buildPublicResXml(), "utf8"));
parts.set("Doc_0/DocumentRes.xml", Buffer.from(buildDocumentResXml(), "utf8"));
parts.set("Doc_0/Tpls/Tpl_0/Content.xml", Buffer.from(buildTemplateXml(), "utf8"));
parts.set("Doc_0/Pages/Page_0/Content.xml", Buffer.from(buildPageXml(), "utf8"));
parts.set("Doc_0/Annots/Annotations.xml", Buffer.from(buildAnnotationsXml(), "utf8"));
parts.set("Doc_0/Annots/Page_0/Annotation.xml", Buffer.from(buildAnnotationXml(), "utf8"));
parts.set("Doc_0/Attachs/Attachments.xml", Buffer.from(buildAttachmentsXml(), "utf8"));
parts.set(`Doc_0/Attachs/${ATTACHMENT_NAME}`, Buffer.from(buildAttachmentXml(), "utf8"));
parts.set("Doc_0/Res/stamp_demo.png", makeSealPng());
parts.set("Doc_0/Res/qrcode_demo.png", makeQrPng());
parts.set("Doc_0/Signs/Signatures.xml", Buffer.from(buildSignaturesXml(), "utf8"));
parts.set("Doc_0/Signs/Sign_0/SignedValue.dat", Buffer.from(
  "SYNTHETIC PLACEHOLDER - not a real PKCS#7 signature payload\n", "utf8"));
// Built last: the descriptor carries a digest for every other part.
parts.set("Doc_0/Signs/Sign_0/Signature.xml", Buffer.from(buildSignatureXml(parts), "utf8"));

fs.rmSync(outDir, { recursive: true, force: true });
const entries = [];
for (const [rel, data] of parts) {
  const abs = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  entries.push([rel.replace(/\\/g, "/"), data]);
}
console.log(`synthetic OFD fixture: ${parts.size} parts -> ${path.relative(process.cwd(), outDir)}`);

if (process.argv.includes("--zip")) {
  const zipPath = path.join(__dirname, "demo-synthetic.ofd");
  fs.writeFileSync(zipPath, writeZip(entries));
  console.log(`demo package: ${path.relative(process.cwd(), zipPath)} (${fs.statSync(zipPath).size} bytes)`);
}
