import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { PATCH_VERSION } from "./commandcode-documents/patch.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const output = path.join(root, "release/commandcode-documents");
const bundledPackages = new Set();
await build({
  configFile: false,
  publicDir: false,
  logLevel: "warn",
  build: {
    outDir: output,
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    lib: {
      entry: path.join(root, "scripts/commandcode-documents/parser.mjs"),
      formats: ["es"],
      fileName: () => "parser.mjs",
    },
    rollupOptions: { output: { chunkFileNames: "[name]-[hash].mjs" } },
  },
});
const pdf = path.dirname(
  fileURLToPath(import.meta.resolve("pdfjs-dist/package.json")),
);
for (const directory of ["cmaps", "standard_fonts", "wasm", "iccs"])
  fs.cpSync(path.join(pdf, directory), path.join(output, directory), {
    recursive: true,
  });
const licenses = path.join(output, "licenses");
fs.mkdirSync(licenses);
for (const name of [
  "mammoth",
  "pdfjs-dist",
  "turndown",
  "turndown-plugin-gfm",
  "jszip",
])
  bundledPackages.add(
    path.dirname(fileURLToPath(import.meta.resolve(`${name}/package.json`))),
  );
function includeDependencies(dir) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  const require = createRequire(path.join(dir, "package.json"));
  for (const name of Object.keys(pkg.dependencies ?? {})) {
    let dependency;
    try {
      dependency = path.dirname(require.resolve(`${name}/package.json`));
    } catch {
      dependency = path.dirname(require.resolve(name));
      while (!fs.existsSync(path.join(dependency, "package.json")))
        dependency = path.dirname(dependency);
    }
    dependency = fs.realpathSync(dependency);
    if (!bundledPackages.has(dependency)) {
      bundledPackages.add(dependency);
      includeDependencies(dependency);
    }
  }
}
for (const dir of [...bundledPackages]) includeDependencies(dir);
for (const dir of bundledPackages) {
  const { name, version } = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  for (const file of fs
    .readdirSync(dir)
    .filter((file) => /^licen[cs]e(?:\..*)?$/i.test(file)))
    fs.copyFileSync(
      path.join(dir, file),
      path.join(licenses, `${name.replaceAll("/", "-")}-${version}-${file}`),
    );
}
const files = {};
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else
      files[path.relative(output, file).split(path.sep).join("/")] = crypto
        .createHash("sha256")
        .update(fs.readFileSync(file))
        .digest("hex");
  }
}
walk(output);
fs.writeFileSync(
  path.join(output, "bundle.json"),
  JSON.stringify(
    { owner: "cc-switch-documents", version: PATCH_VERSION, files },
    null,
    2,
  ) + "\n",
);
console.log(
  `Built local document parser ${PATCH_VERSION}: ${Object.keys(files).length} files at ${output}`,
);

const packageDir = path.join(root, "release/commandcode-documents-package");
fs.rmSync(packageDir, { recursive: true, force: true });
fs.mkdirSync(path.join(packageDir, "scripts/commandcode-documents"), {
  recursive: true,
});
for (const name of ["patch.mjs", "install.mjs", "desktop-0.1.61.json"])
  fs.copyFileSync(
    path.join(root, "scripts/commandcode-documents", name),
    path.join(packageDir, "scripts/commandcode-documents", name),
  );
fs.copyFileSync(
  path.join(root, "scripts/install-commandcode-documents.mjs"),
  path.join(packageDir, "scripts/install-commandcode-documents.mjs"),
);
fs.cpSync(output, path.join(packageDir, "release/commandcode-documents"), {
  recursive: true,
});
fs.copyFileSync(
  path.join(root, "docs/PERSONAL-RELEASE.md"),
  path.join(packageDir, "README.md"),
);
const archive = path.join(
  root,
  `release/commandcode-documents-${PATCH_VERSION}.tar.gz`,
);
execFileSync("tar", ["-czf", archive, "-C", packageDir, "."]);
console.log(`Packaged installer: ${archive}`);
