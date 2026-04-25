export function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDensityLabel(value: "light" | "balanced" | "immersive") {
  if (value === "light") return "Light";
  if (value === "balanced") return "Balanced";
  return "Immersive";
}
