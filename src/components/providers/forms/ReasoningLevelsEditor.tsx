import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, ChevronDown } from "lucide-react";
import { REASONING_LEVELS } from "@/config/reasoningLevels";
import { cn } from "@/lib/utils";
import { fieldClass } from "@/components/ui/input";
import { HoverTip } from "@/components/ui/hover-tip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// Trigger label for the picked levels, kept narrow for the catalog cell. Each
// run of three or more adjacent canonical levels collapses to "first → last"
// ("none, low → max" when minimal is skipped); a range never spans a gap, so
// it can't imply an unpicked level. Non-canonical order stays a plain list.
export function formatReasoningLevelsLabel(levels: string[]): string {
  const canonical = REASONING_LEVELS as readonly string[];
  const positions = levels.map((level) => canonical.indexOf(level));
  const ordered = positions.every(
    (position, index) =>
      position >= 0 && (index === 0 || position > positions[index - 1]),
  );
  if (!ordered) return levels.join(", ");

  const parts: string[] = [];
  let runStart = 0;
  for (let index = 1; index <= levels.length; index++) {
    if (
      index < levels.length &&
      positions[index] === positions[index - 1] + 1
    ) {
      continue;
    }
    const run = levels.slice(runStart, index);
    if (run.length >= 3) {
      parts.push(`${run[0]} → ${run[run.length - 1]}`);
    } else {
      parts.push(...run);
    }
    runStart = index;
  }
  return parts.join(", ");
}

// Sentinel for the default-level Select: Radix Select forbids empty item
// values, so "back to Auto" needs a non-empty value mapped to undefined.
const AUTO_DEFAULT_REASONING_LEVEL = "__auto__";

export function ReasoningLevelsEditor({
  levels,
  defaultLevel,
  onLevelsChange,
  onDefaultLevelChange,
  ariaLabel,
  hint,
}: {
  levels?: string[];
  defaultLevel?: string;
  onLevelsChange: (levels: string[] | undefined) => void;
  onDefaultLevelChange?: (level: string | undefined) => void;
  ariaLabel?: string;
  hint?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const selected = (levels ?? []).filter((level) =>
    (REASONING_LEVELS as readonly string[]).includes(level),
  );

  const toggleLevel = (level: string) => {
    const picked = selected.includes(level)
      ? selected.filter((item) => item !== level)
      : [...selected, level];
    // Store in canonical ascending-depth order (not click order): the Codex
    // picker and the generated catalog both follow array order.
    const next = (REASONING_LEVELS as readonly string[]).filter((item) =>
      picked.includes(item),
    );
    onLevelsChange(next.length > 0 ? next : undefined);
    if (defaultLevel && !next.includes(defaultLevel)) {
      onDefaultLevelChange?.(undefined);
    }
  };

  const triggerLabel =
    selected.length > 0
      ? formatReasoningLevelsLabel(selected)
      : t("codexConfig.reasoningLevelsNotSet", {
          defaultValue: "Not set",
        });

  // The label may be a range or truncated, so hovering spells out every
  // picked level plus the default one.
  const triggerTip =
    selected.length > 0 ? (
      <>
        <div>{selected.join(", ")}</div>
        {defaultLevel && (
          <div>
            {t("codexConfig.defaultReasoningLevelTip", {
              level: defaultLevel,
              defaultValue: "Default level: {{level}}",
            })}
          </div>
        )}
      </>
    ) : undefined;

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <HoverTip content={triggerTip}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-label={ariaLabel}
            aria-expanded={open}
            // 和同一行的 Input、Select 同一套外观，行高才对得齐。
            className={cn(
              fieldClass,
              "flex h-8 items-center justify-between gap-1 whitespace-nowrap text-start data-[state=open]:border-ring data-[state=open]:ring-[3px] data-[state=open]:ring-ring/20",
            )}
          >
            <span
              className={cn("truncate", selected.length === 0 && "text-fg-3")}
            >
              {triggerLabel}
            </span>
            <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
          </button>
        </PopoverTrigger>
      </HoverTip>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        avoidCollisions
        collisionPadding={8}
        // Flipping alone can't help when neither side of the trigger has
        // room for the whole panel (short window, row mid-form): cap it to
        // the space Radix measured and let the level list scroll instead of
        // cutting off the bottom, including the default-level picker.
        className="z-[1000] flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] flex-col p-0 border-border"
      >
        <Command className="min-h-0 flex-1">
          <CommandInput
            placeholder={t("codexConfig.reasoningLevelsSearch", {
              defaultValue: "Search reasoning levels...",
            })}
          />
          <CommandList>
            <CommandEmpty>
              {t("codexConfig.reasoningLevelsEmpty", {
                defaultValue: "No levels",
              })}
            </CommandEmpty>
            <CommandGroup>
              {REASONING_LEVELS.map((level) => (
                <CommandItem
                  key={level}
                  value={level}
                  onSelect={() => toggleLevel(level)}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      selected.includes(level) ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="flex-1">{level}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        {onDefaultLevelChange && selected.length > 0 && (
          <div className="shrink-0 border-t border-border p-2">
            <span className="text-xs text-fg-2">
              {t("codexConfig.defaultReasoningLevelLabel", {
                defaultValue: "Default level",
              })}
            </span>
            <Select
              value={defaultLevel ?? AUTO_DEFAULT_REASONING_LEVEL}
              onValueChange={(value) =>
                onDefaultLevelChange?.(
                  value === AUTO_DEFAULT_REASONING_LEVEL ? undefined : value,
                )
              }
            >
              <SelectTrigger className="mt-1 h-8 w-full">
                <SelectValue
                  placeholder={t(
                    "codexConfig.defaultReasoningLevelPlaceholder",
                    { defaultValue: "Auto" },
                  )}
                />
              </SelectTrigger>
              {/* Must render above the enclosing z-[1000] popover: the
                  default SelectContent z-[100] would hide the menu behind
                  the panel when it flips upward. */}
              <SelectContent className="z-[1100]">
                <SelectItem value={AUTO_DEFAULT_REASONING_LEVEL}>
                  {t("codexConfig.defaultReasoningLevelPlaceholder", {
                    defaultValue: "Auto",
                  })}
                </SelectItem>
                {selected.map((level) => (
                  <SelectItem key={level} value={level}>
                    {level}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {hint && (
          <p className="shrink-0 border-t border-border p-2 text-xs text-fg-2">
            {hint}
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}
