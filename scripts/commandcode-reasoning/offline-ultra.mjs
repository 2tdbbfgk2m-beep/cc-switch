import assert from "node:assert/strict";
// Runs the real native agent loop, native agent tool, SDK streaming and request-budget seam.
export async function verifyNativeUltra(h) {
  const runtime = h.createNodeRuntime();
  const model = "synthetic/gpt-6.1-sol";
  const bodies = [];
  let childrenActive = 0,
    peakChildren = 0,
    rootCalls = 0;
  const events = [];
  const config = h.parseProvidersConfig({
    provider: {
      synthetic: {
        api: "openai-responses",
        baseURL: "https://synthetic.invalid/v1",
        apiKey: false,
        models: { "gpt-6.1-sol": { reasoningEfforts: ["low", "high"] } },
      },
    },
  });
  assert.deepEqual(
    config.providers[0].models[0].reasoningEfforts,
    ["low", "high", "ultra"],
    "desktop provider metadata must advertise the local mode",
  );
  const modules = h.createDeclarativeProviderModules({
    config,
    runtime,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(init.body);
      bodies.push(body);
      assert.equal(body.reasoning.effort, "high");
      assert.ok(body.max_output_tokens <= 8192);
      const isChild = !body.tools?.some((tool) => tool.name === "agent");
      if (isChild) {
        childrenActive++;
        peakChildren = Math.max(peakChildren, childrenActive);
        await new Promise((r) => setImmediate(r));
        childrenActive--;
      }
      const chunks = [
        {
          type: "response.created",
          response: {
            id: "resp_" + bodies.length,
            created_at: 0,
            model: "gpt-6.1-sol",
          },
        },
      ];
      if (!isChild)
        assert.ok(
          JSON.stringify(body.input).includes("PRESERVED_SYNTHETIC_USER_RULES"),
        );
      if (!isChild && rootCalls++ === 0) {
        for (let i = 0; i < 3; i++) {
          const item = {
            type: "function_call",
            id: "fc_" + i,
            call_id: "call_" + i,
            name: "agent",
            status: "completed",
            arguments: JSON.stringify({
              description: "Synthetic child " + i,
              subagent_type: "general",
              prompt: "CHILD_SYNTHETIC_" + i,
            }),
          };
          chunks.push(
            {
              type: "response.output_item.added",
              output_index: i,
              item: { ...item, arguments: "" },
            },
            {
              type: "response.function_call_arguments.delta",
              item_id: item.id,
              output_index: i,
              delta: item.arguments,
            },
            { type: "response.output_item.done", output_index: i, item },
          );
        }
      } else {
        chunks.push(
          {
            type: "response.output_item.added",
            output_index: 0,
            item: { type: "message", id: "msg_synthetic", role: "assistant" },
          },
          {
            type: "response.output_text.delta",
            output_index: 0,
            content_index: 0,
            item_id: "msg_synthetic",
            delta: isChild ? "Child complete" : "All three results integrated",
          },
          {
            type: "response.output_item.done",
            output_index: 0,
            item: {
              type: "message",
              id: "msg_synthetic",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: isChild
                    ? "Child complete"
                    : "All three results integrated",
                },
              ],
            },
          },
        );
      }
      chunks.push({
        type: "response.completed",
        response: {
          usage: {
            input_tokens: 20,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 10 },
          },
        },
      });
      return new Response(
        chunks
          .map(
            (x) => "event: " + x.type + "\ndata: " + JSON.stringify(x) + "\n\n",
          )
          .join(""),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  }).modules;

  const provider = h.createProviderRegistry({
    modules,
    runtime,
    credentials: { get: async () => undefined },
    isZdr: () => false,
  });
  const registry = provider.modelRegistry(),
    client = provider.modelClient();
  assert.deepEqual(registry.getSupportedEfforts({ model }), [
    "low",
    "high",
    "ultra",
  ]);
  const definitions = [
    {
      name: "general",
      description: "Synthetic bounded worker",
      model: "inherit",
      tools: [],
      systemPrompt: "Return a brief synthetic result",
      maxTurns: 100,
    },
  ];
  const agent = h.createAgentTool({
    registry: {
      list: () => definitions,
      get: ({ name }) => definitions.find((d) => d.name === name),
    },
    runtime,
    modelClient: client,
    modelRegistry: registry,
    sessionModel: () => model,
    fallbackModel: () => model,
    fallbackEffort: () => "ultra",
    isByok: () => true,
    availableTools: () => [],
    permissions: () => ({ check: async () => "allow" }),
    mods: () => [],
    onEvent: (e) => events.push(e),
  });
  const result = await h.run({
    state: h.createAgentState({ sessionId: "synthetic-ultra-root" }),
    userInput:
      "Resolve three independent synthetic checks and integrate their results.",
    config: {
      model,
      effort: "ultra",
      modelRegistry: registry,
      modelClient: client,
      toolRunner: h.createToolRunner({ runtime, tools: [agent], defer: false }),
      permissions: { check: async () => "allow" },
      toolExecution: "parallel",
      systemPrompt: async () => ({
        text: "PRESERVED_SYNTHETIC_USER_RULES",
        sections: [{ text: "PRESERVED_SYNTHETIC_USER_RULES" }],
      }),
      maxOutputTokens: 128,
      maxTurns: 8,
      onEvent: (e) => events.push(e),
    },
  }).result;
  assert.match(
    result.finalText,
    /All three results integrated/,
    JSON.stringify({
      stop: result.stopReason,
      events: events.filter((e) => /error/.test(e.type)),
      bodies: bodies.map((b) => ({ stream: b.stream, keys: Object.keys(b) })),
      types: events.map((e) => e.type),
      state: result.nextState.messages.at(-1),
    }),
  );
  assert.equal(events.filter((e) => e.type === "subagent_start").length, 3);
  assert.equal(bodies.length, 5);
  assert.equal(peakChildren, 2);
  assert.equal(result.ultraUsage.requests, 5);
  assert.equal(result.ultraUsage.children, 3);
  assert.ok(
    result.ultraUsage.chargedTokens > 0 &&
      result.ultraUsage.chargedTokens <= 64000,
  );
  return {
    nativeSubagents: 3,
    peakConcurrentChildren: peakChildren,
    actualEffort: "high",
    modelRequests: bodies.length,
    chargedTokens: result.ultraUsage.chargedTokens,
    tokenBudget: result.ultraUsage.tokenBudget,
  };
}
