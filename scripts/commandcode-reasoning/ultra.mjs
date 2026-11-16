import { AsyncLocalStorage as CcsUltraStorage } from "node:async_hooks";
import { readFileSync as ccsUltraRead } from "node:fs";
import { homedir as ccsUltraHome } from "node:os";
import { join as ccsUltraJoin } from "node:path";

export const CCS_ULTRA_DEFAULTS = Object.freeze({
  maxConcurrent: 2,
  tokenBudget: 64000,
  maxOutputTokens: 8192,
  maxChildTurns: 8,
  maxRootTurns: 12,
  maxChildren: 6,
});
const CCS_ULTRA_WIRE = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];
function ccsUltraError(message) {
  const error = new Error(`[Ultra] ${message}`);
  error.retryable = false;
  error.code = "CCS_ULTRA_LIMIT";
  return error;
}
export function validateUltraLimits(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw ccsUltraError("预算配置必须为对象");
  const result = { ...CCS_ULTRA_DEFAULTS, ...value };
  const ceilings = {
    maxConcurrent: 8,
    tokenBudget: 10000000,
    maxOutputTokens: 131072,
    maxChildTurns: 100,
    maxRootTurns: 100,
    maxChildren: 64,
  };
  for (const [key, cap] of Object.entries(ceilings)) {
    if (
      !Number.isSafeInteger(result[key]) ||
      result[key] < 1 ||
      result[key] > cap
    )
      throw ccsUltraError(`无效预算设置 ${key}`);
  }
  for (const key of Object.keys(value))
    if (!(key in ceilings)) throw ccsUltraError(`未知预算设置 ${key}`);
  return result;
}
function ccsUltraLimits() {
  try {
    return validateUltraLimits(
      JSON.parse(
        ccsUltraRead(
          ccsUltraJoin(ccsUltraHome(), ".commandcode", "cc-switch-ultra.json"),
          "utf8",
        ),
      ),
    );
  } catch (error) {
    if (error.code === "ENOENT") return validateUltraLimits();
    throw error;
  }
}
export function resolveUltraEffort(effort, supported, model) {
  let allowed = CCS_ULTRA_WIRE.filter(
    (level) => Array.isArray(supported) && supported.includes(level),
  );
  // Reviewed GPT-6 Sol/Astra endpoints reject none/minimal. Never widen a manual whitelist.
  if (/(?:^|\/)gpt-6(?:\.1)?-(?:sol|astra)(?:$|-)/i.test(model))
    allowed = allowed.filter(
      (level) => level !== "none" && level !== "minimal",
    );
  if (!allowed.length)
    throw ccsUltraError(
      `模型 ${model} 没有可用的声明档位；请先在 CCS 配置实际支持的档位`,
    );
  if (!effort || effort === "ultra") return allowed.at(-1);
  if (!allowed.includes(effort))
    throw ccsUltraError(`模型 ${model} 不允许档位 ${effort}`);
  return effort;
}
export function createUltraRuntime({ limits } = {}) {
  const storage = new CcsUltraStorage();
  const rootOf = () => storage.getStore()?.root;
  function normalize(call, registry) {
    if (!rootOf() && call.effort !== "ultra") return call;
    return {
      ...call,
      effort: resolveUltraEffort(
        call.effort,
        registry?.getSupportedEfforts?.({ model: call.model }),
        call.model,
      ),
    };
  }
  function run(params, native) {
    const inherited = storage.getStore();
    if (!inherited && params.config.effort !== "ultra") return native(params);
    const root = inherited?.root ?? {
      limits: limits ? validateUltraLimits(limits) : ccsUltraLimits(),
      spent: 0,
      reserved: 0,
      requests: 0,
      active: 0,
      children: 0,
      waiters: [],
      controller: new AbortController(),
    };
    const config = {
      ...params.config,
      ...normalize(
        { model: params.config.model, effort: params.config.effort },
        params.config.modelRegistry,
      ),
    };
    config.maxTurns = Math.min(
      config.maxTurns ?? Infinity,
      inherited?.child ? root.limits.maxChildTurns : root.limits.maxRootTurns,
    );
    const guidance = `\n\n<ccs-ultra>Ultra is a local orchestration mode. Actual reasoning is ${config.effort}, bounded by each model's declared whitelist. Delegate useful independent work with the native agent tool; use at most ${root.limits.maxConcurrent} concurrent children and ${root.limits.maxChildren} children total. Give each a bounded self-contained task. Prefer read-only investigation and review; avoid concurrent edits to the same files. Wait for and integrate all results with agent_output before your final answer. Simple tasks need no delegation. Main and children share a ${root.limits.tokenBudget} token budget; stop when the runtime reports a limit. Preserve existing approval requirements.</ccs-ultra>`;
    config.mods = [
      ...(config.mods ?? []),
      {
        id: "ccs-ultra",
        appendSystemPrompt: () =>
          inherited?.child
            ? "<ccs-ultra>Return the bounded assigned result; do not delegate recursively. Shared token and turn limits are enforced by the parent runtime. Preserve existing approvals.</ccs-ultra>"
            : guidance,
      },
    ];
    return storage.run(inherited ?? { root, child: false }, () => {
      const handle = native({ ...params, config });
      if (inherited) return handle;
      return {
        ...handle,
        interrupt: () => {
          root.controller.abort();
          handle.interrupt();
        },
        result: Promise.resolve(handle.result)
          .then((result) => ({
            ...result,
            ultraUsage: {
              chargedTokens: root.spent,
              requests: root.requests,
              children: root.children,
              tokenBudget: root.limits.tokenBudget,
            },
          }))
          .finally(() => root.controller.abort()),
      };
    });
  }
  async function child(params, native) {
    const context = storage.getStore();
    if (!context) return native(params);
    const { root } = context;
    if (context.child) throw ccsUltraError("子智能体不能递归派生");
    if (root.controller.signal.aborted || params.signal?.aborted)
      throw ccsUltraError("任务已取消");
    if (root.children >= root.limits.maxChildren)
      throw ccsUltraError("已达到子智能体总数上限");
    root.children++;
    const signal = AbortSignal.any([
      root.controller.signal,
      ...(params.signal ? [params.signal] : []),
    ]);
    if (root.active >= root.limits.maxConcurrent)
      await new Promise((resolve, reject) => {
        const waiter = () => {
          signal.removeEventListener("abort", abort);
          resolve();
        };
        const abort = () => {
          const i = root.waiters.indexOf(waiter);
          if (i >= 0) root.waiters.splice(i, 1);
          reject(ccsUltraError("排队任务已取消"));
        };
        root.waiters.push(waiter);
        signal.addEventListener("abort", abort, { once: true });
      });
    else root.active++;
    try {
      if (signal.aborted) throw ccsUltraError("任务已取消");
      return await storage.run({ root, child: true }, () =>
        native({
          ...params,
          signal,
          definition: {
            ...params.definition,
            maxTurns: Math.min(
              params.definition?.maxTurns ?? Infinity,
              root.limits.maxChildTurns,
            ),
          },
        }),
      );
    } finally {
      const next = root.waiters.shift();
      if (next) next();
      else root.active--;
    }
  }
  async function request(params, native) {
    const root = rootOf();
    if (!root) return native(params.maxOutputTokens);
    if (root.controller.signal.aborted || params.signal?.aborted)
      throw ccsUltraError("任务已取消");
    if (params.omitMaxOutputTokens)
      throw ccsUltraError("当前传输禁用输出上限；请选择普通档位");
    // Byte-based text estimate deliberately over-reserves. Non-text inputs cannot be bounded here.
    const serialized = JSON.stringify({
      messages: params.messages,
      tools: params.tools,
      system: params.system,
      providerOptions: params.providerOptions,
    });
    if (
      /"(?:type|kind)"\s*:\s*"(?:image|image_url|input_image|audio|file|input_file)"/.test(
        serialized,
      )
    )
      throw ccsUltraError("当前 token 预算只支持文本；请使用普通档位处理媒体");
    const input = Buffer.byteLength(serialized, "utf8") + 1024;
    const output = Math.min(
      params.maxOutputTokens ?? root.limits.maxOutputTokens,
      root.limits.maxOutputTokens,
    );
    if (!Number.isSafeInteger(output) || output < 1)
      throw ccsUltraError("无效输出预算");
    const reservation = input + output;
    if (root.spent + root.reserved + reservation > root.limits.tokenBudget)
      throw ccsUltraError("共享 token 预算不足，已停止后续请求");
    root.reserved += reservation;
    root.requests++;
    let charge = reservation;
    try {
      const result = await native(output);
      const usage = result.usage;
      if (
        usage &&
        Number.isSafeInteger(usage.inputTokens) &&
        Number.isSafeInteger(usage.outputTokens) &&
        usage.inputTokens + usage.outputTokens > 0 &&
        usage.inputTokens >= 0 &&
        usage.outputTokens >= 0
      ) {
        const cache =
          (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
        if (Number.isFinite(cache) && cache >= 0)
          charge =
            Math.max(input, usage.inputTokens + cache) + usage.outputTokens;
      }
      return result;
    } finally {
      root.reserved -= reservation;
      root.spent += charge;
      if (root.spent > root.limits.tokenBudget) root.controller.abort();
    }
  }
  return {
    run,
    child,
    request,
    normalize,
    active: () => !!rootOf(),
    signal: (signal) =>
      rootOf()
        ? AbortSignal.any([
            rootOf().controller.signal,
            ...(signal ? [signal] : []),
          ])
        : signal,
  };
}
