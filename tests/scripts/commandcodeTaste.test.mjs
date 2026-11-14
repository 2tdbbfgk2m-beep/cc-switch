import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";

const mod = await import("../../scripts/commandcode-taste.mjs").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") return {};
  throw e;
});

test("a resumed run excludes old history, tool output and assistant reasoning without mutating state", () => {
  assert.equal(
    typeof mod.learningMessages,
    "function",
    "incremental learning is not implemented",
  );
  const old = {
    role: "user",
    content: [{ type: "text", text: "old private history" }],
  };
  const fresh = {
    role: "user",
    meta: { messageId: "new" },
    content: [{ type: "text", text: "Always use descriptive names." }],
  };
  const state = [
    old,
    fresh,
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: "Understood." },
      ],
    },
    {
      role: "user",
      content: [{ type: "tool_result", content: "SECRET TOOL OUTPUT" }],
    },
    {
      role: "user",
      meta: { isSummary: true },
      content: [{ type: "text", text: "injected summary" }],
    },
  ];
  const before = JSON.stringify(state);
  const result = mod.learningMessages(state, fresh);
  assert.deepEqual(result, [
    {
      role: "user",
      content: [{ type: "text", text: "Always use descriptive names." }],
    },
    { role: "assistant", content: [{ type: "text", text: "Understood." }] },
  ]);
  assert.equal(JSON.stringify(state), before);
  assert.deepEqual(
    mod.learningMessages(state.slice(2), fresh),
    [],
    "a lost anchor must not mine old context",
  );
});

async function fixture(run) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "cc-taste-"));
  const dir = path.join(home, ".commandcode");
  await fs.mkdir(dir);
  const requests = [];
  let status = 200;
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({
      headers: req.headers,
      path: req.url,
      body: JSON.parse(body),
    });
    res.writeHead(status, { "content-type": "text/event-stream" });
    if (status !== 200)
      return res.end("FAKE_API_KEY must not appear in errors");
    const events = [
      {
        choices: [
          { delta: { reasoning_content: "do not persist this reasoning" } },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  function: { name: "read_taste_file", arguments: '{"path":' },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '"taste.md"}' } },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
      {
        choices: [],
        usage: { prompt_tokens: 30, completion_tokens: 20, total_tokens: 50 },
      },
    ];
    // Split the SSE bytes inside JSON as well as between events.
    const wire =
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
      "data: [DONE]\n\n";
    for (let n = 0; n < wire.length; n += 13) res.write(wire.slice(n, n + 13));
    res.end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const write = async (name, value) =>
    fs.writeFile(path.join(dir, name), JSON.stringify(value));
  await write("providers.json", {
    provider: {
      "cc-switch-open-code-go": {
        baseURL: `http://127.0.0.1:${server.address().port}/v1`,
        models: { "deepseek-v4.1-flash": {} },
      },
    },
  });
  await write("auth.json", {
    "cc-switch-open-code-go": { type: "api", key: "FAKE_API_KEY" },
  });
  try {
    await run({
      home,
      dir,
      write,
      requests,
      setStatus: (n) => {
        status = n;
      },
    });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(home, { recursive: true, force: true });
  }
}

test("the learning client streams tool calls and sends a stable session header with fresh credentials", async () => {
  assert.equal(
    typeof mod.createLearningClient,
    "function",
    "DS adapter is not implemented",
  );
  await fixture(async ({ home, write, requests }) => {
    const client = mod.createLearningClient({
      home,
      sessionId: "isolated-conversation",
    });
    const params = {
      system: "fictional preferences",
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "My fictional key is FAKE_API_KEY" }],
        },
      ],
      tools: [{ name: "read_taste_file", input_schema: { type: "object" } }],
    };
    const r = await client.complete(params);
    assert.deepEqual(r.content, [
      {
        type: "tool_use",
        id: "call-1",
        name: "read_taste_file",
        input: { path: "taste.md" },
      },
    ]);
    assert.equal(r.stopReason, "tool_use");
    assert.equal(r.usage.inputTokens, 30);
    assert.equal(requests[0].body.model, "deepseek-v4.1-flash");
    assert.equal(requests[0].path, "/v1/chat/completions");
    assert.equal(
      requests[0].headers["x-opencode-session"],
      "isolated-conversation",
    );
    assert.equal(requests[0].headers.authorization, "Bearer FAKE_API_KEY");
    assert(!JSON.stringify(requests[0].body).includes("FAKE_API_KEY"));
    await write("auth.json", {
      "cc-switch-open-code-go": { type: "api", key: "ROTATED_FAKE_KEY" },
    });
    await client.complete({
      ...params,
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call-1",
              name: "read_taste_file",
              input: { path: "taste.md" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call-1",
              content: [{ type: "text", text: "# Existing" }],
            },
          ],
        },
      ],
    });
    assert.equal(requests[1].headers.authorization, "Bearer ROTATED_FAKE_KEY");
    assert.equal(
      requests[1].headers["x-opencode-session"],
      "isolated-conversation",
    );
    assert.equal(requests[1].body.messages[2].role, "tool");
    assert.equal(requests[1].body.messages[2].tool_call_id, "call-1");
  });
});

test("authentication failures hide response bodies and are not retried as transient errors", async () => {
  assert.equal(
    typeof mod.createLearningClient,
    "function",
    "DS adapter is not implemented",
  );
  await fixture(async ({ home, setStatus }) => {
    setStatus(401);
    await assert.rejects(
      mod
        .createLearningClient({ home, sessionId: "test" })
        .complete({ messages: [], tools: [] }),
      (e) => {
        assert(!e.message.includes("FAKE_API_KEY"));
        assert.equal(e.retryable, false);
        return /401/.test(e.message);
      },
    );
  });
});

test("a removed or malformed provider fails closed instead of switching to another model", async () => {
  assert.equal(
    typeof mod.createLearningClient,
    "function",
    "DS adapter is not implemented",
  );
  await fixture(async ({ home, write, requests }) => {
    await write("providers.json", { provider: {} });
    await assert.rejects(
      mod
        .createLearningClient({ home, sessionId: "test" })
        .complete({ messages: [], tools: [] }),
    );
    assert.equal(requests.length, 0);
  });
});

test("installing only adds its own Mod and preserves existing config and sessions", async () => {
  const installer = await import(
    "../../scripts/install-commandcode-taste.mjs"
  ).catch((e) => {
    if (e.code === "ERR_MODULE_NOT_FOUND") return {};
    throw e;
  });
  assert.equal(
    typeof installer.installTaste,
    "function",
    "non-destructive installation is not implemented",
  );
  await fixture(async ({ home, dir }) => {
    await fs.mkdir(path.join(dir, "projects"));
    await fs.writeFile(
      path.join(dir, "config.local.json"),
      '{"model":"KEEP","tasteLearning":false}',
    );
    await fs.writeFile(
      path.join(dir, "projects", "session.jsonl"),
      "KEEP SESSION\n",
    );
    const before = await fs.readFile(
      path.join(dir, "config.local.json"),
      "utf8",
    );
    await installer.installTaste({ home });
    assert.equal(
      await fs.readFile(path.join(dir, "config.local.json"), "utf8"),
      before,
    );
    assert.equal(
      await fs.readFile(path.join(dir, "projects", "session.jsonl"), "utf8"),
      "KEEP SESSION\n",
    );
    const target = path.join(dir, "mods", "cc-switch-taste.mjs");
    assert((await fs.readFile(target, "utf8")).includes("export default"));
    await installer.installTaste({ home });
    await fs.writeFile(target, "// someone else's mod");
    await assert.rejects(installer.installTaste({ home }));
    assert.equal(await fs.readFile(target, "utf8"), "// someone else's mod");
  });
});

test("Taste writes cannot follow a symlink, leave the taste folder or overwrite unread changes", async () => {
  await fixture(async ({ home }) => {
    const project = path.join(home, "project");
    const taste = path.join(project, ".commandcode", "taste");
    await fs.mkdir(taste, { recursive: true });
    const root = path.join(taste, "taste.md");
    await fs.writeFile(root, "old rule");
    const base = { fs: { read: ({ path: p }) => fs.readFile(p, "utf8") } };
    const runtime = mod.tasteRuntime(base, project);
    await assert.rejects(
      runtime.fs.write({ path: root, content: "unread replacement" }),
    );
    await runtime.fs.read({ path: root });
    await fs.writeFile(root, "concurrent user edit");
    await assert.rejects(
      runtime.fs.write({ path: root, content: "stale replacement" }),
    );
    assert.equal(await fs.readFile(root, "utf8"), "concurrent user edit");
    await assert.rejects(
      runtime.fs.write({
        path: path.join(project, "config.json"),
        content: "bad",
      }),
    );
    await fs.symlink(
      path.join(home, ".commandcode", "auth.json"),
      path.join(taste, "linked.md"),
    );
    await assert.rejects(
      runtime.fs.read({ path: path.join(taste, "linked.md") }),
    );
  });
});

test("background passes return immediately, serialize a project and recheck the learning switch", async () => {
  await fixture(async ({ home }) => {
    const project = path.join(home, "project");
    await fs.mkdir(project);
    let release,
      started,
      active = 0,
      maximum = 0,
      enabled = true;
    const entered = new Promise((r) => {
      started = r;
    });
    const barrier = new Promise((r) => {
      release = r;
    });
    const processed = [];
    const harness = {
      isLocalOnly: () => true,
      createNodeRuntime: () => ({ fs: {} }),
      getConfigFile: () => "unused-fixture-config",
      isTasteLearningEnabled: async () => enabled,
      // Only the external native learner is substituted; scheduling is the real Mod.
      createLearner:
        () =>
        async ({ state }) => {
          maximum = Math.max(maximum, ++active);
          started();
          await barrier;
          processed.push(state.messages[0].content[0].text);
          active--;
        },
    };
    const instances = [];
    for (let i = 0; i < 2; i++) {
      let hooks;
      await mod.registerTasteMod(
        {
          cwd: project,
          hooks: (h) => {
            hooks = h;
          },
          ui: { notify: () => {} },
        },
        harness,
        { home },
      );
      instances.push(hooks);
    }
    const state = (text) => ({
      messages: [{ role: "user", content: [{ type: "text", text }] }],
    });
    const a = state("first"),
      b = state("second");
    instances[0].onTurnStart({ state: a, turnNumber: 1 });
    assert.equal(instances[0].onRunEnd({ state: a }), undefined);
    await entered;
    instances[1].onTurnStart({ state: b, turnNumber: 1 });
    assert.equal(instances[1].onRunEnd({ state: b }), undefined);
    enabled = false; // The queued second pass must see the newly disabled switch.
    release();
    await Promise.all([
      ...globalThis[Symbol.for("cc-switch.taste.queues")].values(),
    ]);
    assert.equal(maximum, 1);
    assert.deepEqual(processed, ["first"]);
    assert.equal(
      instances[0].onRunEnd({ state: a }),
      undefined,
      "a repeated callback must not replay history",
    );
  });
});
