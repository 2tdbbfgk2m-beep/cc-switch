// Runs inside Command Code's existing renderer sandbox. Never reads paths or uploads files.
const MAX_INPUT = 20 * 1024 * 1024;
const MAX_TEXT = 500 * 1024;
const MAX_PAGES = 100;
const MAX_IMAGES = 8;
let docxModules;
let pdfModule;

export class DocumentAttachmentError extends Error {}

export function isDocumentFile(file) {
  return /\.(docx|pdf)$/i.test(file.name ?? "");
}

export function documentErrorMessage(error) {
  return error instanceof DocumentAttachmentError
    ? error.message
    : "无法解析文档，请检查文件是否完整、未加密。";
}

function fail(message) {
  throw new DocumentAttachmentError(message);
}

async function readDocx(data) {
  docxModules ??= Promise.all([
    import("jszip"),
    import("mammoth/mammoth.browser.js"),
    import("turndown"),
    import("turndown-plugin-gfm"),
  ]);
  const [zipModule, mammothModule, turndownModule, gfm] = await docxModules;
  const archive = await zipModule.default.loadAsync(data);
  const entries = Object.values(archive.files);
  const expandedSize = entries.reduce(
    (total, entry) => total + (entry._data?.uncompressedSize ?? 0),
    0,
  );
  if (entries.length > 5000 || expandedSize > 40 * 1024 * 1024)
    fail("DOCX 解压后内容过大，请拆分文档。");
  if (!archive.file("word/document.xml"))
    fail("不是有效的 DOCX 文档，或文件已损坏。");
  // Check actual expanded bytes too; ZIP directory sizes are untrusted.
  let expanded = 0;
  for (const entry of entries.filter((entry) => !entry.dir)) {
    await new Promise((resolve, reject) => {
      const stream = entry.internalStream("uint8array");
      stream
        .on("data", (chunk) => {
          expanded += chunk.length;
          if (expanded > 40 * 1024 * 1024) {
            stream.pause();
            reject(
              new DocumentAttachmentError("DOCX 解压后内容过大，请拆分文档。"),
            );
          }
        })
        .on("error", reject)
        .on("end", resolve)
        .resume();
    });
  }
  const mammoth = mammothModule.default;
  const result = await mammoth.convertToHtml(
    { arrayBuffer: data },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement((image) =>
        Promise.resolve({ src: "", alt: image.altText || "文档内图片" }),
      ),
    },
  );
  const markdown = new turndownModule.default({
    headingStyle: "atx",
    bulletListMarker: "-",
  });
  markdown.use(gfm.gfm);
  const cellContent = new WeakMap();
  markdown.addRule("documentCell", {
    filter: ["td", "th"],
    replacement: (content, node) => {
      cellContent.set(node, content);
      return content;
    },
  });
  // DOCX need not contain an explicit table header; keep every row as a Markdown table.
  markdown.addRule("documentTable", {
    filter: "table",
    replacement: (_content, node) => {
      const spans = [],
        rows = [];
      for (const row of Array.from(node.getElementsByTagName("tr"))) {
        let table = row.parentNode;
        while (table && table.nodeName.toLowerCase() !== "table")
          table = table.parentNode;
        if (table !== node) continue;
        const cells = [];
        for (let col = 0; col < spans.length; col++)
          if (spans[col]?.remaining > 0) {
            cells[col] = spans[col].text;
            spans[col].remaining--;
          }
        let col = 0;
        for (const cell of Array.from(row.childNodes).filter((child) =>
          /^(td|th)$/i.test(child.nodeName),
        )) {
          while (cells[col] !== undefined) col++;
          const width = Number(cell.getAttribute("colspan") || 1),
            height = Number(cell.getAttribute("rowspan") || 1);
          if (
            !Number.isInteger(width) ||
            !Number.isInteger(height) ||
            width < 1 ||
            height < 1 ||
            col + width > 256 ||
            height > 10000
          )
            fail("DOCX 表格过大或合并格式异常，请拆分表格后添加。");
          const text = (cellContent.get(cell) ?? "")
            .trim()
            .replace(/\n+/g, " <br> ")
            .replace(/\|/g, "\\|");
          for (let offset = 0; offset < width; offset++) {
            cells[col + offset] = offset ? "" : text;
            if (height > 1)
              spans[col + offset] = {
                text: offset ? "" : text,
                remaining: height - 1,
              };
          }
          col += width;
        }
        rows.push(cells);
      }
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const lines = rows.map(
        (row) =>
          "| " +
          Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ") +
          " |",
      );
      lines.splice(1, 0, "| " + Array(width).fill("---").join(" | ") + " |");
      return "\n\n" + lines.join("\n") + "\n\n";
    },
  });
  markdown.addRule("documentImage", {
    filter: "img",
    replacement: (_content, node) =>
      `[图片：${node.getAttribute("alt") || "文档内图片"}，未提取图像内容]`,
  });
  markdown.addRule("safeLinks", {
    filter: "a",
    replacement: (content, node) => {
      const href = node.getAttribute("href") ?? "";
      return /^(https?:|mailto:|#)/i.test(href)
        ? `[${content}](${href.replace(/[()]/g, encodeURIComponent)})`
        : content;
    },
  });
  return { text: markdown.turndown(result.value), images: [] };
}

async function getPdfModule() {
  pdfModule ??= (async () => {
    // PDF.js supports a local main-thread handler. No Worker is created: the
    // desktop's worker-src 'none' and all other CSP directives stay unchanged.
    globalThis.pdfjsWorker = await import("pdfjs-dist/build/pdf.worker.mjs");
    return import("pdfjs-dist/build/pdf.mjs");
  })();
  return pdfModule;
}

async function pageImage(page, name, number) {
  const base = page.getViewport({ scale: 1 });
  const viewport = page.getViewport({
    scale: Math.min(2, 1600 / Math.max(base.width, base.height)),
  });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(viewport.width));
  canvas.height = Math.max(1, Math.ceil(viewport.height));
  try {
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) fail("无法生成 PDF 页面图片，请重新打开桌面版后重试。");
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob || blob.size > 8 * 1024 * 1024)
      fail("PDF 页面图片过大，请拆分或压缩文档。");
    return new File(
      [blob],
      `${name.replace(/\.pdf$/i, "")}-page-${number}.png`,
      { type: "image/png" },
    );
  } finally {
    canvas.width = canvas.height = 1;
  }
}

async function readPdf(data, options) {
  const pdfjs = await getPdfModule();
  const base = options.assetsBaseUrl ?? new URL("./", import.meta.url).href;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    useWorkerFetch: false,
    isEvalSupported: false,
    disableFontFace: true,
    cMapPacked: true,
    cMapUrl: new URL("cmaps/", base).href,
    standardFontDataUrl: new URL("standard_fonts/", base).href,
    wasmUrl: new URL("wasm/", base).href,
    iccUrl: new URL("iccs/", base).href,
  });
  let pdf;
  try {
    pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES)
      fail(`PDF 超过 ${MAX_PAGES} 页，请拆分后添加。`);
    const pages = [],
      images = [];
    const budget = Math.max(
      0,
      Math.min(MAX_IMAGES, options.imageBudget ?? MAX_IMAGES),
    );
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const { items } = await page.getTextContent();
        const text = items
          .map((item) =>
            "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
          )
          .join("")
          .trim();
        if (text) pages.push(`## 第 ${number} 页\n\n${text}`);
        else {
          if (images.length >= budget)
            fail(
              "扫描 PDF 所需图片超出当前剩余容量（每条消息最多 8 张），请清除已有图片或拆分 PDF。",
            );
          images.push(await pageImage(page, options.name, number));
          pages.push(
            `## 第 ${number} 页\n\n此页无可提取文字，已作为页面图片附件添加，请结合图片读取。`,
          );
        }
        if (new TextEncoder().encode(pages.join("\n\n")).length > MAX_TEXT)
          fail("文档解析文本超过 500 KB，请拆分后添加。");
      } finally {
        page.cleanup();
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return { text: pages.join("\n\n"), images };
  } catch (error) {
    if (error?.name === "PasswordException")
      fail("PDF 已加密，请先解锁并另存副本后添加。");
    throw error;
  } finally {
    await task.destroy();
  }
}

export async function parseDocumentAttachment(file, options = {}) {
  if (!isDocumentFile(file)) fail("目前仅支持 DOCX 和 PDF 文档解析。");
  if (file.size > MAX_INPUT) fail("文档大小超过 20 MB，请压缩或拆分后添加。");
  try {
    const data = await file.arrayBuffer();
    if (data.byteLength > MAX_INPUT)
      fail("文档大小超过 20 MB，请压缩或拆分后添加。");
    const result = /\.docx$/i.test(file.name)
      ? await readDocx(data)
      : await readPdf(data, { ...options, name: file.name });
    if (!result.text.trim()) fail("文档中未提取到内容，请检查文件是否完整。");
    if (new TextEncoder().encode(result.text).length > MAX_TEXT)
      fail("文档解析文本超过 500 KB，请拆分后添加。");
    return { kind: "text", content: result.text, images: result.images };
  } catch (error) {
    if (error instanceof DocumentAttachmentError) throw error;
    fail(
      /\.docx$/i.test(file.name)
        ? "DOCX 解析失败，文件可能已损坏或受密码保护。"
        : "PDF 解析失败，文件可能已损坏或不受支持。",
    );
  }
}
