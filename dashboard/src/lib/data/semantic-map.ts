import type { SemanticGraphSnapshot } from "@/lib/types/dashboard";

// The live dashboard now loads semantic graph data from the Node backend.
// Keep this helper as a no-op so older imports do not pull stale local JSON snapshots.
export function loadSemanticGraphSnapshot(): SemanticGraphSnapshot | null {
  return null;
}
