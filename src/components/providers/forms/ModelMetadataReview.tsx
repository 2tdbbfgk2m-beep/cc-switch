import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { V7Dialog } from "@/components/mcp/formBits";
import { modelsDevQueryOptions } from "@/lib/modelsDev";
import {
  resolveModelMetadata,
  type PresetModelSource,
} from "@/lib/modelMetadata";
import {
  modelMetadataFromConfig,
  inspectModelMetadata,
  modelFieldsFor,
  type ModelDialect,
  type ModelMetadataField,
} from "@/lib/modelCapabilities";
import { withSharedPresetModelSources } from "@/config/presetModelMetadata";

export interface ReviewModel {
  key: string;
  id: string;
  value: unknown;
  baseUrl?: string;
}
interface Props {
  models: ReviewModel[];
  dialect: ModelDialect;
  baseUrl: string;
  presets: () => readonly PresetModelSource[];
  onFill?: (key: string, id: string) => void;
}
const labels: Record<string, string> = {
  contextWindow: "上下文",
  maxOutputTokens: "输出上限",
  reasoning: "推理能力",
  reasoningEfforts: "推理档位",
  inputModalities: "输入模态",
  outputModalities: "输出模态",
};
const display = (value: unknown) =>
  value === undefined
    ? "—"
    : Array.isArray(value)
      ? value.join(", ") || "[]"
      : String(value);

/** Read-only until a fill button is clicked. Saving stays with the enclosing provider form. */
export function ModelMetadataReview({
  models,
  dialect,
  baseUrl,
  presets,
  onFill,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { data, isFetching, isError } = useQuery({
    ...modelsDevQueryOptions,
    enabled: open,
  });
  const sources = open ? withSharedPresetModelSources(presets()) : [];
  const rows = open
    ? models
        .filter((row) => row.id.trim() && !/^model-\d+$/.test(row.id))
        .map((row) => {
          const known = resolveModelMetadata(row.id, {
            baseUrl: row.baseUrl ?? baseUrl,
            presets: sources,
            modelsDev: data,
            diagnostics: true,
          });
          const current = modelMetadataFromConfig(row.value, dialect);
          const fields = modelFieldsFor(dialect);
          return {
            ...row,
            known,
            current,
            fields,
            issues: inspectModelMetadata(
              onFill ? current : (known ?? {}),
              known,
              fields,
            ),
          };
        })
    : [];
  const fieldLabel = (field: ModelMetadataField) =>
    t(`providerForm.modelReview.fields.${field}`, {
      defaultValue: labels[field] ?? field,
    });
  const canFill = (row: (typeof rows)[number]) =>
    row.issues.some((issue) => issue.kind === "missing");
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 gap-1"
        onClick={() => setOpen(true)}
        disabled={!models.some((model) => model.id.trim())}
      >
        <ListChecks className="h-3.5 w-3.5" />
        {t("providerForm.modelReview.title", { defaultValue: "检查模型配置" })}
      </Button>
      <V7Dialog open={open} width={700} onOpenChange={setOpen}>
        <DialogTitle>
          {t("providerForm.modelReview.title", {
            defaultValue: "检查模型配置",
          })}
        </DialogTitle>
        <DialogDescription>
          {t(
            onFill
              ? "providerForm.modelReview.description"
              : "providerForm.modelReview.nativeDescription",
            {
              defaultValue: onFill
                ? "仅补空字段；已设置的限制保持不变。冲突仅供核对，未知能力不猜测。补全结果保留在当前表单，保存后才生效。"
                : "这些能力由原生客户端管理；这里只核对公共模型资料，不向配置写入额外字段。",
            },
          )}
        </DialogDescription>
        {isFetching && (
          <p role="status" className="text-caption text-fg-2">
            {t("providerForm.modelReview.loading", {
              defaultValue: "正在读取公共模型资料…",
            })}
          </p>
        )}
        {isError && (
          <p role="status" className="text-caption text-fg-2">
            {t("providerForm.modelReview.offline", {
              defaultValue: "公共资料暂不可用，使用内置目录。",
            })}
          </p>
        )}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {rows.map((row) => (
            <section
              key={row.key}
              className="rounded-lg border border-border p-3 space-y-2"
              aria-label={row.id}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="min-w-0 break-all text-sm">{row.id}</strong>
                {onFill && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!canFill(row)}
                    onClick={() => onFill?.(row.key, row.id)}
                  >
                    {t("providerForm.modelReview.fill", {
                      defaultValue: "补全空字段",
                    })}
                  </Button>
                )}
              </div>
              <p className="text-caption text-fg-2">
                {t("providerForm.modelReview.source", {
                  defaultValue: "参考来源",
                })}
                :{" "}
                {row.known?.sources.join(" + ") ||
                  t("providerForm.modelReview.unknown", {
                    defaultValue: "未知",
                  })}
              </p>
              <table className="w-full text-caption">
                <thead>
                  <tr className="text-left text-fg-2">
                    <th>
                      {t("providerForm.modelReview.parameter", {
                        defaultValue: "参数",
                      })}
                    </th>
                    <th>
                      {t("providerForm.modelReview.current", {
                        defaultValue: "当前值",
                      })}
                    </th>
                    <th>
                      {t("providerForm.modelReview.reference", {
                        defaultValue: "参考值",
                      })}
                    </th>
                    <th>
                      {t("providerForm.modelReview.status", {
                        defaultValue: "检查结果",
                      })}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {row.fields.map((field) => {
                    const issue = row.issues.find(
                      (issue) => issue.field === field,
                    );
                    return (
                      <tr key={field}>
                        <td className="py-1">{fieldLabel(field)}</td>
                        <td className="max-w-40 break-words">
                          {display(row.current[field])}
                        </td>
                        <td
                          className="max-w-48 break-words"
                          title={row.known?.fieldSources?.[field]}
                        >
                          {display(row.known?.[field])}
                        </td>
                        <td>
                          {issue
                            ? t(`providerForm.modelReview.${issue.kind}`, {
                                defaultValue: {
                                  missing: "缺失",
                                  unknown: "未知",
                                  conflict: "冲突（保留当前值）",
                                }[issue.kind],
                              })
                            : "✓"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!!row.known?.conflicts?.length && (
                <p className="text-caption text-fg-2">
                  {t("providerForm.modelReview.sourceConflict", {
                    defaultValue: "资料来源存在差异，按同供应商优先取值",
                  })}
                  : {row.known.conflicts.map(fieldLabel).join(", ")}
                </p>
              )}
            </section>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          {onFill && (
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                rows.filter(canFill).forEach((row) => onFill?.(row.key, row.id))
              }
              disabled={!rows.some(canFill)}
            >
              {t("providerForm.modelReview.fillAll", {
                defaultValue: "补全全部空字段",
              })}
            </Button>
          )}
          <Button type="button" onClick={() => setOpen(false)}>
            {t("common.close", { defaultValue: "关闭" })}
          </Button>
        </div>
      </V7Dialog>
    </>
  );
}
