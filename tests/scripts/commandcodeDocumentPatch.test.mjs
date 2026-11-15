import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  desktop,
  patchRenderer,
} from "../../scripts/commandcode-documents/patch.mjs";
import {
  isDocumentFile,
  parseDocumentAttachment,
  documentErrorMessage,
} from "../../scripts/commandcode-documents/parser.mjs";
import { docxFixture } from "./helpers/documentFixtures.mjs";

const m = desktop.markers;
const fixture = `${m.modelRead}\n${m.batch}\n
function classify(l,d,c,a){${m.inlineCondition}return 'inline'}return 'reference'}
function imageHook(){${m.imageHookReturn}}
function imageHookUse(){const ${m.imageHookUse}()}
async function attach(H){const ge={draftKey:he.current},Ae=Je.current;try{${m.apply}}finally{}}
`;

function runParser(parser = parseDocumentAttachment) {
  const files = [],
    images = [],
    warnings = [];
  const ctx = vm.createContext({
    ccSwitchIsDocument: isDocumentFile,
    ccSwitchParseDocument: parser,
    ccSwitchDocumentError: documentErrorMessage,
    Tg: 100000,
    pK: async (file) => new Uint8Array(await file.arrayBuffer()),
    cK: () => false,
    fK: (bytes) => {
      if (bytes.includes(0)) return null;
      try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        return null;
      }
    },
    hK: (s) => Math.ceil(s.length / 4),
    Ag: (s) => s,
    he: { current: "original" },
    Je: { current: 0 },
    ccDocImageCount: { current: 0 },
    ce: { current: 0 },
    _g: 8,
    h: true,
    Ct: (value) => warnings.push(value),
    vK: () => warnings.push("binary"),
    wK: () => warnings.push("large"),
    ks: (values) => files.push(...values),
    ee: (values) => images.push(...values),
    ccDocIngestAtomic: async (values) => {
      images.push(...values);
      return true;
    },
  });
  vm.runInContext(patchRenderer(fixture).replace(/^import[^\n]+\n/, ""), ctx);
  return { ctx, files, images, warnings };
}

test("patched dispatcher parses DOCX while keeping plain text behavior", async () => {
  const { ctx, files } = runParser();
  await ctx.attach([
    {
      file: new File([await docxFixture()], "sample.docx"),
      path: "/sample.docx",
      name: "sample.docx",
    },
    {
      file: new File(["keep plain"], "sample.txt"),
      path: "/sample.txt",
      name: "sample.txt",
    },
  ]);
  assert.equal(files.length, 2);
  assert.match(files[0].content, /虚构实施方案/);
  assert.equal(files[1].content, "keep plain");
  assert.equal(
    ctx.classify(false, "sample.docx", "/project/sample.docx", {
      name: "sample.docx",
    }),
    "inline",
  );
  assert.equal(
    ctx.classify(false, "sample.txt", "/project/sample.txt", {
      name: "sample.txt",
    }),
    "reference",
  );
});

test("a broken document is reported without dropping the other attachment", async () => {
  const { ctx, files, warnings } = runParser();
  await ctx.attach([
    {
      file: new File(["broken"], "bad.docx"),
      name: "bad.docx",
      path: "/bad.docx",
    },
    { file: new File(["good"], "good.md"), name: "good.md", path: "/good.md" },
  ]);
  assert.equal(files.length, 1);
  assert.equal(files[0].content, "good");
  assert.match(warnings[0].message, /bad.docx/);
});

test("stale parsing never writes into a different draft", async () => {
  let ctx;
  const state = runParser(async (file, opts) => {
    const parsed = await parseDocumentAttachment(file, opts);
    ctx.he.current = "different";
    return parsed;
  });
  ctx = state.ctx;
  await ctx.attach([
    {
      file: new File([await docxFixture()], "sample.docx"),
      name: "sample.docx",
      path: "/sample.docx",
    },
  ]);
  assert.equal(state.files.length, 0);
  assert.equal(state.images.length, 0);
});

test("capacity changes reject a scan instead of silently truncating pages", async () => {
  let ctx;
  const state = runParser(async () => {
    ctx.ccDocImageCount.current = 8;
    return {
      kind: "text",
      content: "scanned page",
      images: [
        new File(["synthetic image"], "page.png", { type: "image/png" }),
      ],
    };
  });
  ctx = state.ctx;
  await ctx.attach([
    {
      file: new File(["%PDF"], "scan.pdf"),
      name: "scan.pdf",
      path: "/scan.pdf",
    },
  ]);
  assert.equal(state.files.length, 0);
  assert.equal(state.images.length, 0);
  assert.match(state.warnings[0].message, /容量/);
});

test("a failed image batch cannot leave misleading scanned-document text in the draft", async () => {
  const state = runParser(async () => ({
    kind: "text",
    content: "page images attached",
    images: [new File(["image"], "page.png", { type: "image/png" })],
  }));
  state.ctx.ccDocIngestAtomic = async () => false;
  await state.ctx.attach([
    {
      file: new File(["%PDF"], "scan.pdf"),
      name: "scan.pdf",
      path: "/scan.pdf",
    },
  ]);
  assert.equal(state.files.length, 0);
  assert.equal(state.images.length, 0);
  assert.ok(state.warnings.length);
});

test("unknown patch boundaries fail before modification", () => {
  assert.throws(() => patchRenderer("unknown renderer"), /不匹配|unsupported/i);
});
