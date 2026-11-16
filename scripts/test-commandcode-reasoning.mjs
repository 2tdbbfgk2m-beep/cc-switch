import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import {
  patchFullHarness,
  patchSdk,
  WIRE_LEVELS as LEVELS,
} from "./commandcode-reasoning/patch.mjs";
import { prepareInstall } from "./commandcode-reasoning/install.mjs";
import { verifyNativeUltra } from "./commandcode-reasoning/offline-ultra.mjs";
const appAt = process.argv.indexOf("--app");
const source = path.resolve(
  appAt < 0 ? "/Applications/Command Code.app" : process.argv[appAt + 1],
  "Contents/Resources/app",
);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ccs-effort-native-"));
const root = path.join(tempRoot, "Contents/Resources/app");
try {
  function linkModules(from, to, except) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from))
      if (!except.includes(entry))
        fs.symlinkSync(path.join(from, entry), path.join(to, entry));
  }
  linkModules(
    path.join(source, "node_modules"),
    path.join(root, "node_modules"),
    ["@commandcode", "@ai-sdk"],
  );
  for (const [scope, exceptions] of [
    ["@commandcode", ["harness"]],
    ["@ai-sdk", ["openai", "anthropic"]],
  ])
    linkModules(
      path.join(source, "node_modules", scope),
      path.join(root, "node_modules", scope),
      exceptions,
    );
  for (const name of [
    "@commandcode/harness",
    "@ai-sdk/openai",
    "@ai-sdk/anthropic",
  ])
    fs.cpSync(
      path.join(source, "node_modules", name),
      path.join(root, "node_modules", name),
      { recursive: true },
    );
  const harnessFile = path.join(
    root,
    "node_modules/@commandcode/harness/dist/index.js",
  );
  const installPlan = prepareInstall(path.resolve(source, "../../.."));
  fs.writeFileSync(
    harnessFile,
    installPlan.patched?.harness ??
      patchFullHarness(fs.readFileSync(harnessFile, "utf8")),
  );
  for (const name of ["openai", "anthropic"])
    for (const ext of ["js", "mjs"]) {
      const file = path.join(
        root,
        `node_modules/@ai-sdk/${name}/dist/index.${ext}`,
      );
      fs.writeFileSync(file, patchSdk(fs.readFileSync(file, "utf8"), name));
    }
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls++;
    throw Error("Network is forbidden");
  };
  const runtimeDir = path.resolve(root, "../cc-switch-reasoning");
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.copyFileSync(
    new URL("./commandcode-reasoning/ultra.mjs", import.meta.url),
    path.join(runtimeDir, "ultra.mjs"),
  );
  const h = await import(pathToFileURL(harnessFile));
  const records = {};
  for (const api of [
    "openai-responses",
    "openai-completions",
    "anthropic-messages",
  ]) {
    const model =
      api === "anthropic-messages" ? "claude-opus-5-5" : "gpt-6.1-sol";
    const bodies = [];
    const config = h.parseProvidersConfig({
      provider: {
        synthetic: {
          api,
          baseURL:
            api === "anthropic-messages"
              ? "https://api.anthropic.com"
              : "https://api.openai.com/v1",
          apiKey: false,
          models: { [model]: { reasoningEfforts: LEVELS } },
        },
      },
    });
    const module = h.createDeclarativeProviderModules({
      config,
      runtime: h.createNodeRuntime(),
      fetchImpl: async (_url, init) => {
        const body = JSON.parse(init.body);
        bodies.push(body);
        const reply =
          api === "openai-responses"
            ? {
                id: "resp_synthetic",
                object: "response",
                created_at: 0,
                model,
                status: "completed",
                output: [
                  {
                    id: "msg_synthetic",
                    type: "message",
                    role: "assistant",
                    status: "completed",
                    content: [
                      { type: "output_text", text: "OK", annotations: [] },
                    ],
                  },
                ],
                usage: {
                  input_tokens: 1,
                  output_tokens: 1,
                  total_tokens: 2,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens_details: { reasoning_tokens: 0 },
                },
              }
            : api === "openai-completions"
              ? {
                  id: "chat_synthetic",
                  object: "chat.completion",
                  created: 0,
                  model,
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "OK" },
                      finish_reason: "stop",
                    },
                  ],
                  usage: {
                    prompt_tokens: 1,
                    completion_tokens: 1,
                    total_tokens: 2,
                  },
                }
              : {
                  id: "msg_synthetic",
                  type: "message",
                  role: "assistant",
                  model,
                  content: [{ type: "text", text: "OK" }],
                  stop_reason: "end_turn",
                  stop_sequence: null,
                  usage: { input_tokens: 1, output_tokens: 1 },
                };
        return new Response(JSON.stringify(reply), {
          headers: { "content-type": "application/json" },
        });
      },
    }).modules[0];
    const id = `synthetic/${model}`;
    const registry = h.createModelRegistry({ models: module.models });
    assert.deepEqual(registry.getSupportedEfforts({ model: id }), [
      ...LEVELS,
      "ultra",
    ]);
    const sdk = module.transport.buildModel({
      model: id,
      auth: { headers: {} },
    });
    for (const effort of LEVELS) {
      const base = module.transport.providerOptions?.({ model: id }) ?? {};
      const extra =
        module.hooks.thinking({ model: id, effort, knownEfforts: LEVELS }) ??
        {};
      const options = { ...base, ...extra };
      for (const key of new Set([...Object.keys(base), ...Object.keys(extra)]))
        options[key] = { ...base[key], ...extra[key] };
      await sdk.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Synthetic offline check" }],
          },
        ],
        providerOptions: options,
      });
    }
    const sent = bodies.map((body) =>
      api === "openai-responses"
        ? body.reasoning?.effort
        : api === "openai-completions"
          ? body.reasoning_effort
          : body.output_config?.effort,
    );
    assert.deepEqual(sent, LEVELS, api);
    records[api] = sent;
  }
  assert.equal(networkCalls, 0);
  const ultra = await verifyNativeUltra(h);
  assert.equal(networkCalls, 0);
  console.log(JSON.stringify({ records, ultra, networkCalls }));
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
