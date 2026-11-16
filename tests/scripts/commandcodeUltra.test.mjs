import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createUltraRuntime,
  resolveUltraEffort,
  validateUltraLimits,
} from "../../scripts/commandcode-reasoning/ultra.mjs";
const registry = {
  getSupportedEfforts: ({ model }) =>
    model.includes("limited")
      ? ["low", "high", "ultra"]
      : model.includes("off")
        ? null
        : ["low", "medium", "high", "xhigh", "max", "ultra"],
};
const params = (effort = "ultra") => ({
  config: {
    model: "test/limited",
    effort,
    modelRegistry: registry,
    modelClient: {},
    onEvent() {},
  },
  state: { sessionId: "synthetic" },
});
const tick = () => new Promise((resolve) => setImmediate(resolve));
test("Ultra resolves through the manual whitelist and never becomes an API value", () => {
  assert.equal(
    resolveUltraEffort("ultra", ["low", "high"], "test/limited"),
    "high",
  );
  assert.equal(
    resolveUltraEffort("low", ["low", "high"], "test/limited"),
    "low",
  );
  assert.throws(
    () => resolveUltraEffort("max", ["low", "high"], "test/limited"),
    /档位/,
  );
  assert.throws(() => resolveUltraEffort("ultra", [], "test/off"), /档位/);
  assert.equal(
    resolveUltraEffort(
      "ultra",
      ["none", "minimal", "high"],
      "custom/gpt-6.1-sol",
    ),
    "high",
  );
  assert.throws(
    () => resolveUltraEffort("ultra", ["minimal"], "custom/gpt-6.1-sol"),
    /档位/,
  );
});
test("invalid and unbounded limits are rejected", () => {
  for (const tokenBudget of [0, -1, Infinity, NaN, "64000"])
    assert.throws(() => validateUltraLimits({ tokenBudget }));
  assert.throws(() => validateUltraLimits({ maxConcurrent: 0 }));
  assert.equal(validateUltraLimits({ maxConcurrent: 1 }).maxConcurrent, 1);
});
test("ordinary max runs retain their original objects and behavior", () => {
  const runtime = createUltraRuntime();
  const p = params("max");
  let received;
  runtime.run(p, (x) => {
    received = x;
    return { result: Promise.resolve({}), interrupt() {} };
  });
  assert.equal(received, p);
});
test("native children share a bounded queue, inherited policy and cancellation", async () => {
  const runtime = createUltraRuntime({
    limits: { maxConcurrent: 2, tokenBudget: 64000 },
  });
  let active = 0,
    peak = 0;
  const gates = [];
  const run = runtime.run(params(), (p) => ({
    interrupt() {},
    result: (async () => {
      assert.equal(p.config.effort, "high");
      const children = Array.from({ length: 3 }, (_, i) =>
        runtime.child(
          {
            definition: { maxTurns: 100 },
            signal: new AbortController().signal,
          },
          async (child) => {
            active++;
            peak = Math.max(peak, active);
            assert.ok(child.definition.maxTurns <= 8);
            await new Promise((resolve) => gates.push(resolve));
            active--;
            return i;
          },
        ),
      );
      await tick();
      assert.equal(gates.length, 2);
      gates.shift()();
      await tick();
      assert.equal(gates.length, 2);
      for (const release of gates) release();
      assert.deepEqual(await Promise.all(children), [0, 1, 2]);
      return {};
    })(),
  }));
  await run.result;
  assert.equal(peak, 2);
});
test("concurrent requests reserve shared input/output budget before sending", async () => {
  const runtime = createUltraRuntime({
    limits: { tokenBudget: 4000, maxOutputTokens: 2000 },
  });
  let release,
    sent = 0;
  const result = runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const request = {
        messages: [],
        tools: [],
        system: "synthetic",
        maxOutputTokens: 2000,
      };
      const first = runtime.request(request, async (cap) => {
        sent++;
        assert.equal(cap, 2000);
        await new Promise((r) => (release = r));
        return { usage: { inputTokens: 20, outputTokens: 20 } };
      });
      await tick();
      await assert.rejects(
        () =>
          runtime.request(request, async () => {
            sent++;
            return {};
          }),
        /预算/,
      );
      release();
      await first;
      return {};
    })(),
  }));
  await result.result;
  assert.equal(sent, 1);
});
test("failed requests without usage consume their reservation and retries stop", async () => {
  const runtime = createUltraRuntime({
    limits: { tokenBudget: 4000, maxOutputTokens: 2000 },
  });
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const request = {
        messages: [],
        tools: [],
        system: "synthetic",
        maxOutputTokens: 2000,
      };
      await assert.rejects(
        () =>
          runtime.request(request, async () => {
            throw Error("upstream disconnected");
          }),
        /disconnected/,
      );
      await assert.rejects(
        () => runtime.request(request, async () => ({})),
        /预算/,
      );
      return {};
    })(),
  })).result;
});
test("root completion cancels detached native children and independent sessions have separate budgets", async () => {
  const runtime = createUltraRuntime();
  let signal;
  const run = runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      void runtime.child({ definition: {} }, async (p) => {
        signal = p.signal;
        await new Promise((r) =>
          p.signal.addEventListener("abort", r, { once: true }),
        );
        return {};
      });
      await tick();
      return {};
    })(),
  }));
  await run.result;
  assert.ok(signal.aborted);
  await runtime.run(params(), () => ({
    interrupt() {},
    result: runtime.request(
      { messages: [], tools: [], system: "other", maxOutputTokens: 10 },
      async () => ({ usage: { inputTokens: 1, outputTokens: 1 } }),
    ),
  })).result;
});
test("queued children keep their slot when a fresh spawn races with a release", async () => {
  const runtime = createUltraRuntime({ limits: { maxConcurrent: 1 } });
  let active = 0,
    peak = 0;
  const releases = [];
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const spawn = () =>
        runtime.child({ definition: {} }, async () => {
          active++;
          peak = Math.max(active, peak);
          await new Promise((r) => releases.push(r));
          active--;
        });
      const a = spawn();
      const b = spawn();
      await tick();
      releases.shift()();
      await Promise.resolve();
      const c = spawn();
      await tick();
      releases.shift()();
      await tick();
      releases.shift()();
      await Promise.all([a, b, c]);
      return {};
    })(),
  })).result;
  assert.equal(peak, 1);
});
test("zero usage is treated as missing accounting, not a free request", async () => {
  const runtime = createUltraRuntime({
    limits: { tokenBudget: 6000, maxOutputTokens: 2000 },
  });
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const request = {
        messages: [],
        tools: [],
        system: "synthetic",
        maxOutputTokens: 2000,
      };
      await runtime.request(request, async () => ({
        usage: { inputTokens: 0, outputTokens: 0 },
      }));
      await assert.rejects(
        () => runtime.request(request, async () => ({})),
        /预算/,
      );
      return {};
    })(),
  })).result;
});
test("a native child waiting for a slot is cancelled without running", async () => {
  const runtime = createUltraRuntime({ limits: { maxConcurrent: 1 } });
  let release;
  let started = 0;
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const a = runtime.child({ definition: {} }, async () => {
        await new Promise((r) => (release = r));
        return {};
      });
      const controller = new AbortController();
      const b = runtime.child(
        { definition: {}, signal: controller.signal },
        async () => {
          started++;
          return {};
        },
      );
      controller.abort();
      await assert.rejects(() => b, /取消/);
      release();
      await a;
      return {};
    })(),
  })).result;
  assert.equal(started, 0);
});
test("async structured system prompts and cache sections remain intact", async () => {
  const runtime = createUltraRuntime();
  const p = params();
  const structured = {
    text: "User rules",
    sections: [{ text: "User rules", cacheControl: { type: "ephemeral" } }],
  };
  p.config.systemPrompt = async () => structured;
  await runtime.run(p, (config) => ({
    interrupt() {},
    result: (async () => {
      assert.equal(await config.config.systemPrompt({}), structured);
      assert.equal(config.config.systemPrompt, p.config.systemPrompt);
      assert.match(config.config.mods.at(-1).appendSystemPrompt(), /ccs-ultra/);
      return {};
    })(),
  })).result;
});
test("Ultra refuses transports which explicitly omit output caps and unpriced media", async () => {
  const runtime = createUltraRuntime();
  let sent = 0;
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      const call = () => {
        sent++;
        return {};
      };
      await assert.rejects(
        () =>
          runtime.request(
            { messages: [], tools: [], omitMaxOutputTokens: true },
            call,
          ),
        /输出/,
      );
      await assert.rejects(
        () =>
          runtime.request(
            {
              messages: [{ content: [{ type: "image", image: "synthetic" }] }],
              tools: [],
            },
            call,
          ),
        /文本/,
      );
      return {};
    })(),
  })).result;
  assert.equal(sent, 0);
});
test("provider-injected instructions are included in the input reservation", async () => {
  const runtime = createUltraRuntime({
    limits: { tokenBudget: 3000, maxOutputTokens: 1000 },
  });
  let sent = 0;
  await runtime.run(params(), () => ({
    interrupt() {},
    result: (async () => {
      await assert.rejects(
        () =>
          runtime.request(
            {
              messages: [],
              tools: [],
              providerOptions: { openai: { instructions: "x".repeat(3000) } },
            },
            async () => {
              sent++;
              return {};
            },
          ),
        /预算/,
      );
      return {};
    })(),
  })).result;
  assert.equal(sent, 0);
});
