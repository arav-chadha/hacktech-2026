import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
};

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex h-10 items-center justify-center rounded-xl border px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-100 disabled:cursor-not-allowed disabled:opacity-60",
        variant === "primary" &&
          "border-accent-600 bg-accent-600 text-white hover:border-accent-700 hover:bg-accent-700",
        variant === "secondary" &&
          "border-ink-300 bg-white text-ink-800 hover:border-ink-400 hover:bg-ink-50",
        variant === "ghost" &&
          "border-transparent bg-transparent text-ink-500 hover:bg-ink-100 hover:text-ink-900",
        className
      )}
      {...props}
    />
  );
}
