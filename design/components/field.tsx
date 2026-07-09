import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/design/lib/cn";

/**
 * Input / Textarea (U2 / R15) — the kit's text fields.
 *
 * INFERRED, and honestly so: EliseAI ships no form-field style we could read off
 * the marketing site. These are composed only from verified tokens — a white
 * surface, the `--gray-lines` border, the 4px control radius that matches every
 * Button, ink body text, and the `--light-grey` placeholder — so a field sits on
 * the same row as a Button without a seam. Focus paints a soft brand halo
 * (`--color-brand-100`) rather than the OS outline, the one bespoke touch, kept
 * to a focus state.
 *
 * They exist so a screen that needs a text field (U17's "request an integration")
 * composes from the kit instead of hand-rolling a styled `<input>` in the page —
 * the exact drift `design/rules.ts` forbids.
 */

const FIELD_BASE =
  "w-full rounded-control border border-line bg-surface font-sans text-base text-ink " +
  "placeholder:text-ink-faint transition-colors " +
  "hover:border-line-cool " +
  "focus:border-brand focus:outline-none focus:shadow-[0_0_0_3px_var(--color-brand-100)] " +
  "disabled:cursor-not-allowed disabled:opacity-50";

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "className"> {
  className?: string;
}

export function Input({ className, type = "text", ...rest }: InputProps) {
  return (
    <input type={type} className={cn(FIELD_BASE, "px-3.5 py-2.5", className)} {...rest} />
  );
}

export interface TextareaProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> {
  className?: string;
}

export function Textarea({ className, rows = 3, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      className={cn(FIELD_BASE, "resize-y px-3.5 py-2.5 leading-relaxed", className)}
      {...rest}
    />
  );
}
