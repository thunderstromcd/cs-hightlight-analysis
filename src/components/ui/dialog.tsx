"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as React from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  body,
  returnFocus,
  initialFocus,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  body?: React.ReactNode;
  returnFocus?: React.RefObject<HTMLElement | null>;
  initialFocus?: React.RefObject<HTMLElement | null>;
  children?: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="work-dialog-overlay fixed inset-0 z-50 bg-background/75 backdrop-blur-sm" />
        <DialogPrimitive.Content
          {...(description ? {} : { "aria-describedby": undefined })}
          onOpenAutoFocus={initialFocus ? (event) => {
            event.preventDefault();
            initialFocus.current?.focus();
          } : undefined}
          onCloseAutoFocus={returnFocus ? (event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          } : undefined}
          className={cn(
            "work-dialog fixed top-1/2 left-1/2 z-50 flex max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border bg-card p-4 text-card-foreground shadow-2xl focus:outline-none sm:p-6",
          )}
        >
          <div className="flex items-center justify-between gap-3">
            <DialogPrimitive.Title className="text-xl font-semibold">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close className="grid size-10 shrink-0 place-items-center rounded-full text-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" aria-label="关闭">×</DialogPrimitive.Close>
          </div>
          {description ? (
            <DialogPrimitive.Description className="mt-3 text-base leading-normal text-muted-foreground">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {body ? <div className="mt-4 min-h-0 overflow-y-auto p-1">{body}</div> : null}
          {children ? <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2">{children}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
