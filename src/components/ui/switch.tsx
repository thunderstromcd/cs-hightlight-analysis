"use client";

import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  const on = checked && !disabled;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex min-h-11 w-full items-center justify-between gap-4 rounded-xl border border-border bg-background px-3 text-left text-base text-foreground transition-colors duration-200 hover:border-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border",
        className,
      )}
    >
      <span>{label}</span>
      <span className="flex items-center gap-2">
        <span aria-hidden className={cn("text-sm", on ? "text-accent" : "text-muted-foreground")}>{on ? "开" : "关"}</span>
        <span aria-hidden className="relative h-6 w-11 shrink-0 rounded-full border border-border bg-muted">
          <span
            className={cn(
              "absolute top-0.5 left-0 size-4.5 rounded-full transition-transform duration-200",
              on ? "translate-x-5 bg-accent" : "translate-x-0.5 bg-muted-foreground",
            )}
          />
        </span>
      </span>
    </button>
  );
}
