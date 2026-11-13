import { useCallback, useEffect, useMemo, useState } from "react";
import {
  commandcodeRouteApi,
  type ModelSlot,
  type RouteProvider,
  type SlotEntry,
} from "@/lib/api/commandcodeRoute";

const inputClass =
  "w-full rounded-md border border-border-default bg-bg-base px-2 py-1 text-sm text-fg-1 outline-none focus:border-border-strong";

function entryLabel(options: RouteProvider[], entry: SlotEntry) {
  const provider = options.find((item) => item.id === entry.providerId);
  const model = provider?.models.find((item) => item.id === entry.modelId);
  return `${provider?.name ?? entry.providerId} · ${model?.name ?? entry.modelId}`;
}

/** Command Code 的直连 / 路由切换和模型槽编辑。 */
export function CommandcodeRoutePanel() {
  const [mode, setMode] = useState<boolean | null>(null);
  const [slots, setSlots] = useState<ModelSlot[]>([]);
  const [options, setOptions] = useState<RouteProvider[]>([]);
  const [editing, setEditing] = useState<ModelSlot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [enabled, list, opts] = await Promise.all([
        commandcodeRouteApi.getMode(),
        commandcodeRouteApi.slots(),
        commandcodeRouteApi.options(),
      ]);
      setMode(enabled);
      setSlots(list);
      setOptions(opts);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void reload();
    // 在别处新增/修改了供应商后回到这个窗口，选项要重新读。
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);

  const toggleMode = async (enabled: boolean) => {
    setBusy(true);
    setError("");
    try {
      setMode(await commandcodeRouteApi.setMode(enabled));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startCreate = () => {
    setEditing({ id: "", name: "", entries: [] });
    setError("");
  };

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError("");
    try {
      const id = editing.id.trim() || editing.name.trim().replace(/\s+/g, "-");
      setSlots(
        await commandcodeRouteApi.saveSlot({
          ...editing,
          id,
          name: editing.name.trim() || id,
        }),
      );
      setEditing(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    setError("");
    try {
      setSlots(await commandcodeRouteApi.deleteSlot(id));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const availableModels = useMemo(
    () =>
      options
        .filter((provider) => provider.id !== "router")
        .flatMap((provider) =>
          provider.models.map((model) => ({
            providerId: provider.id,
            modelId: model.id,
            label: `${provider.name} · ${model.name}`,
          })),
        ),
    [options],
  );

  if (mode === null) return null;

  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-fg-1">Command Code 路由</div>
          <div className="text-xs text-fg-3">
            路由模式下由 CC Switch 按模型槽的优先级转发请求，失败自动切换。
          </div>
        </div>
        <div className="flex rounded-md border border-border-default p-0.5 text-xs">
          {[
            { label: "直连", value: false },
            { label: "路由", value: true },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={busy}
              onClick={() => void toggleMode(item.value)}
              className={
                mode === item.value
                  ? "rounded bg-fg-1 px-3 py-1 text-bg-base"
                  : "rounded px-3 py-1 text-fg-2 hover:text-fg-1"
              }
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {mode && (
        <div className="space-y-2">
          {slots.length === 0 && (
            <div className="text-xs text-fg-3">
              还没有槽位。建一个槽位，里面按优先级放模型；在 Command Code 里选
              <code className="mx-1 rounded bg-bg-base px-1">
                router/槽位标识
              </code>
              就会走这条路。
            </div>
          )}
          {slots.map((slot) => (
            <div
              key={slot.id}
              className="flex items-center justify-between gap-3 rounded-md border border-border-default px-3 py-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm text-fg-1">
                  {slot.name}
                  <span className="ml-2 text-xs text-fg-3">
                    router/{slot.id}
                  </span>
                </div>
                <div className="truncate text-xs text-fg-3">
                  {slot.entries.length === 0
                    ? "没有候选"
                    : slot.entries
                        .map((entry) => entryLabel(options, entry))
                        .join(" → ")}
                </div>
              </div>
              <div className="flex shrink-0 gap-2 text-xs">
                <button
                  type="button"
                  className="text-fg-2 hover:text-fg-1"
                  onClick={() => {
                    setEditing(structuredClone(slot));
                    setError("");
                  }}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="text-red-500 hover:text-red-400"
                  disabled={busy}
                  onClick={() => void remove(slot.id)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="text-xs text-fg-2 hover:text-fg-1"
            onClick={startCreate}
          >
            + 新建槽位
          </button>
        </div>
      )}

      {error && <div className="text-xs text-red-500">{error}</div>}

      {editing && (
        <div className="space-y-2 rounded-md border border-border-strong p-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1 text-xs text-fg-3">
              名称
              <input
                className={inputClass}
                value={editing.name}
                placeholder="编程"
                onChange={(e) =>
                  setEditing({ ...editing, name: e.target.value })
                }
              />
            </label>
            <label className="space-y-1 text-xs text-fg-3">
              标识（Command Code 里显示为 router/标识）
              <input
                className={inputClass}
                value={editing.id}
                placeholder="coding"
                disabled={slots.some((slot) => slot.id === editing.id)}
                onChange={(e) => setEditing({ ...editing, id: e.target.value })}
              />
            </label>
          </div>

          <div className="space-y-1">
            {editing.entries.map((entry, index) => (
              <div
                key={`${entry.providerId}/${entry.modelId}/${index}`}
                className="flex items-center justify-between gap-2 rounded border border-border-default px-2 py-1 text-xs"
              >
                <span className="truncate text-fg-1">
                  {index + 1}. {entryLabel(options, entry)}
                </span>
                <span className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    disabled={index === 0}
                    className="text-fg-3 hover:text-fg-1 disabled:opacity-30"
                    onClick={() => {
                      const entries = [...editing.entries];
                      [entries[index - 1], entries[index]] = [
                        entries[index],
                        entries[index - 1],
                      ];
                      setEditing({ ...editing, entries });
                    }}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={index === editing.entries.length - 1}
                    className="text-fg-3 hover:text-fg-1 disabled:opacity-30"
                    onClick={() => {
                      const entries = [...editing.entries];
                      [entries[index + 1], entries[index]] = [
                        entries[index],
                        entries[index + 1],
                      ];
                      setEditing({ ...editing, entries });
                    }}
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="text-red-500 hover:text-red-400"
                    onClick={() =>
                      setEditing({
                        ...editing,
                        entries: editing.entries.filter((_, i) => i !== index),
                      })
                    }
                  >
                    ✕
                  </button>
                </span>
              </div>
            ))}
            <select
              className={inputClass}
              value=""
              onFocus={() => void reload()}
              onChange={(e) => {
                const picked = availableModels.find(
                  (item) =>
                    `${item.providerId}/${item.modelId}` === e.target.value,
                );
                if (!picked) return;
                if (
                  editing.entries.some(
                    (entry) =>
                      entry.providerId === picked.providerId &&
                      entry.modelId === picked.modelId,
                  )
                )
                  return;
                setEditing({
                  ...editing,
                  entries: [
                    ...editing.entries,
                    {
                      providerId: picked.providerId,
                      modelId: picked.modelId,
                    },
                  ],
                });
              }}
            >
              <option value="">按优先级添加模型…</option>
              {availableModels.map((item) => (
                <option
                  key={`${item.providerId}/${item.modelId}`}
                  value={`${item.providerId}/${item.modelId}`}
                >
                  {item.label}
                </option>
              ))}
            </select>
            {availableModels.length === 0 && (
              <div className="text-xs text-fg-3">
                没有可用的候选：只有 anthropic-messages 格式的 Command Code
                供应商能进槽位。
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="rounded border border-border-default px-3 py-1 text-fg-2"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
            <button
              type="button"
              disabled={busy || !editing.name.trim()}
              className="rounded bg-fg-1 px-3 py-1 text-bg-base disabled:opacity-40"
              onClick={() => void save()}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
