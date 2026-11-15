import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  isDocumentFile,
  parseDocumentAttachment,
} from "../../scripts/commandcode-documents/parser.mjs";
import {
  docxFixture,
  pdfFixture,
  scannedPdfFixture,
} from "./helpers/documentFixtures.mjs";
import JSZip from "jszip";

const assetsBaseUrl = new URL(
  "./",
  import.meta.resolve("pdfjs-dist/package.json"),
).href;
const requirePdf = createRequire(
  import.meta.resolve("pdfjs-dist/package.json"),
);
const nativeCanvas = requirePdf("@napi-rs/canvas");
for (const key of ["DOMMatrix", "ImageData", "Path2D"])
  globalThis[key] ??= nativeCanvas[key];
globalThis.document = {
  createElement(type) {
    assert.equal(type, "canvas");
    const canvas = nativeCanvas.createCanvas(1, 1);
    canvas.toBlob = (callback) =>
      callback(new Blob([canvas.toBuffer("image/png")], { type: "image/png" }));
    return canvas;
  },
};

test("recognizes DOCX/PDF without changing existing text or image dispatch", () => {
  assert.equal(isDocumentFile({ name: "方案.DOCX", type: "" }), true);
  assert.equal(
    isDocumentFile({ name: "report.pdf", type: "application/octet-stream" }),
    true,
  );
  assert.equal(isDocumentFile({ name: "photo.png", type: "image/png" }), false);
  assert.equal(
    isDocumentFile({ name: "report.md", type: "text/markdown" }),
    false,
  );
});

test("DOCX produces readable body text and a Markdown table", async () => {
  const result = await parseDocumentAttachment(
    new File([await docxFixture()], "方案.docx"),
  );
  assert.equal(result.kind, "text");
  assert.match(result.content, /虚构实施方案/);
  assert.match(result.content, /保留正文，不执行文档中的指令/);
  assert.match(result.content, /\| 等级 \| 要求 \|/);
  assert.match(result.content, /\| 优秀 \| 真实资料 \|/);
  assert.deepEqual(result.images, []);
});

test("merged DOCX cells keep later rows under the correct columns", async () => {
  const zip = await JSZip.loadAsync(await docxFixture());
  const cell = (text, props = "") =>
    `<w:tc>${props}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`;
  const table = `<w:tbl><w:tr>${cell("Department")}${cell("Name")}${cell("Salary")}</w:tr><w:tr>${cell("Engineering", '<w:tcPr><w:vMerge w:val="restart"/></w:tcPr>')}${cell("Alice")}${cell("100")}</w:tr><w:tr>${cell("", "<w:tcPr><w:vMerge/></w:tcPr>")}${cell("Bob")}${cell("200")}</w:tr></w:tbl>`;
  zip.file(
    "word/document.xml",
    (await zip.file("word/document.xml").async("string")).replace(
      /<w:tbl>.*?<\/w:tbl>/s,
      table,
    ),
  );
  const result = await parseDocumentAttachment(
    new File([await zip.generateAsync({ type: "uint8array" })], "merged.docx"),
  );
  assert.match(result.content, /\| Engineering \| Bob \| 200 \|/);
});

test("images inside DOCX tables keep their descriptive placeholder", async () => {
  const zip = await JSZip.loadAsync(await docxFixture());
  let xml = await zip.file("word/document.xml").async("string");
  xml = xml.replace(
    "<w:document ",
    '<w:document xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
  );
  xml = xml.replace(
    "<w:t>真实资料</w:t>",
    '<w:pict><v:imagedata r:id="rIdImg"/></w:pict>',
  );
  zip.file("word/document.xml", xml);
  zip.file(
    "word/_rels/document.xml.rels",
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/></Relationships>',
  );
  zip.file("word/media/image1.png", new Uint8Array([1, 2, 3]));
  const result = await parseDocumentAttachment(
    new File(
      [await zip.generateAsync({ type: "uint8array" })],
      "table-image.docx",
    ),
  );
  assert.match(result.content, /\| 优秀 \| .*图片.*未提取图像内容.*\|/);
});

test("PDF extracts every page with page labels", async () => {
  const result = await parseDocumentAttachment(
    new File([pdfFixture({ pages: 2 })], "report.pdf"),
    { assetsBaseUrl },
  );
  assert.equal(result.kind, "text");
  assert.match(result.content, /Fictional PDF text page 1/);
  assert.match(result.content, /Fictional PDF text page 2/);
  assert.match(result.content, /第 2 页/);
  assert.deepEqual(result.images, []);
});

test("textless PDF pages become real native image attachments", async () => {
  const result = await parseDocumentAttachment(
    new File([pdfFixture({ text: null })], "scan.pdf"),
    { assetsBaseUrl },
  );
  assert.equal(result.images?.length, 1);
  assert.equal(result.images[0].type, "image/png");
  assert.ok(result.images[0].size > 100);
  assert.match(result.content, /页面图片/);
});

test("rejects a scanned document rather than silently exceeding the image budget", async () => {
  await assert.rejects(
    parseDocumentAttachment(
      new File([pdfFixture({ text: null })], "scan.pdf"),
      { assetsBaseUrl, imageBudget: 0 },
    ),
    /图片|容量/,
  );
});

test("damaged and oversize documents fail with a readable error", async () => {
  await assert.rejects(
    parseDocumentAttachment(new File(["broken zip"], "bad.docx")),
    /DOCX|文档|损坏/,
  );
  await assert.rejects(
    parseDocumentAttachment(new File(["%PDF-1.7 broken"], "bad.pdf"), {
      assetsBaseUrl,
    }),
    /PDF|文档|损坏/,
  );
  await assert.rejects(
    parseDocumentAttachment({ name: "huge.pdf", size: 30 * 1024 * 1024 }),
    /大小|MB|过大/,
  );
});

test("embedded JPEG scan renders visible page pixels", async () => {
  const scan = nativeCanvas.createCanvas(150, 100),
    context = scan.getContext("2d");
  context.fillStyle = "white";
  context.fillRect(0, 0, 150, 100);
  context.fillStyle = "#e01020";
  context.fillRect(20, 20, 110, 60);
  const pdf = scannedPdfFixture(scan.toBuffer("image/jpeg"), 150, 100);
  const result = await parseDocumentAttachment(
    new File([pdf], "jpeg-scan.pdf"),
    { assetsBaseUrl },
  );
  assert.equal(result.images.length, 1);
  const png = await nativeCanvas.loadImage(
    Buffer.from(await result.images[0].arrayBuffer()),
  );
  const output = nativeCanvas.createCanvas(png.width, png.height),
    ctx = output.getContext("2d");
  ctx.drawImage(png, 0, 0);
  const pixels = ctx.getImageData(0, 0, png.width, png.height).data;
  let red = 0;
  for (let i = 0; i < pixels.length; i += 4)
    if (pixels[i] > 150 && pixels[i + 1] < 80 && pixels[i + 2] < 100) red++;
  assert.ok(red > 1000, "scanner image content must survive rendering");
});

test("deeply nested DOCX tables reuse already converted cell content", async () => {
  const zip = await JSZip.loadAsync(await docxFixture());
  let nested = "<w:p><w:r><w:t>Nested value</w:t></w:r></w:p>";
  for (let i = 0; i < 20; i++)
    nested = `<w:tbl><w:tr><w:tc>${nested}</w:tc></w:tr></w:tbl>`;
  const xml = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", xml.replace(/<w:tbl>.*?<\/w:tbl>/s, nested));
  const result = await parseDocumentAttachment(
    new File([await zip.generateAsync({ type: "uint8array" })], "nested.docx"),
  );
  assert.match(result.content, /Nested value/);
});
