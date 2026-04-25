import { cn } from "@/lib/utils/cn";

type Option<T extends string> = {
  label: string;
  value: T;
};

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex rounded-xl border border-ink-200 bg-ink-50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-3 py-2 text-sm font-medium transition",
            value === option.value
              ? "bg-white text-ink-900 shadow-sm"
              : "text-ink-500 hover:text-ink-900"
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
