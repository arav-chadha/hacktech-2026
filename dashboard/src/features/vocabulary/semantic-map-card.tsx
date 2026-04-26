"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/section-heading";
import type {
  SemanticAnchorNode,
  SemanticGraphNode,
  SemanticGraphSnapshot,
  SemanticLearnedWordNode,
} from "@/lib/types/dashboard";
import { cn } from "@/lib/utils/cn";

const ForceGraph3D = dynamic(
  () => import("react-force-graph-3d").then((module) => module.default),
  { ssr: false }
);

type SemanticMapCardProps = {
  snapshot: SemanticGraphSnapshot | null;
  selectedNodeId: string | null;
  languageLabels: Record<string, string>;
  onSelectNode: (node: SemanticGraphNode | null) => void;
};

type GraphNode = SemanticGraphNode & {
  val: number;
  color: string;
};

type GraphLink = {
  source: string;
  target: string;
  kind: "anchor" | "semantic-neighbor";
};

function isAnchorNode(node: SemanticGraphNode): node is SemanticAnchorNode {
  return node.kind === "anchor";
}

function isLearnedNode(node: SemanticGraphNode): node is SemanticLearnedWordNode {
  return node.kind === "learned-word";
}

export function SemanticMapCard({
  snapshot,
  selectedNodeId,
  languageLabels,
  onSelectNode,
}: SemanticMapCardProps) {
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphWidth, setGraphWidth] = useState(900);

  const anchorBaseColor = "#94a3b8";
  const learnedLanguageColors: Record<string, string> = {
    es: "#5b7c99",
    fr: "#6b7c93",
    de: "#73808d",
    ja: "#687b72",
  };

  const graphData = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    const nodes: GraphNode[] = snapshot.nodes.map((node) => ({
      ...node,
      val: node.kind === "anchor" ? 8.5 : 3.1,
      color:
        node.kind === "anchor"
          ? anchorBaseColor
          : learnedLanguageColors[node.languageCode] ?? "#64748b",
    }));

    const links: GraphLink[] = snapshot.links.map((link) => ({
      source: link.source,
      target: link.target,
      kind: snapshot.nodes.some(
        (node) => node.kind === "learned-word" && node.id === link.target && node.anchorId === link.source
      )
        ? "anchor"
        : "semantic-neighbor",
    }));

    return { nodes, links };
  }, [snapshot]);

  const selectedNode = useMemo(
    () => snapshot?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [selectedNodeId, snapshot]
  );

  const relatedLearnedNodes = useMemo(() => {
    if (!snapshot || !selectedNode) {
      return [];
    }

    if (isAnchorNode(selectedNode)) {
      return snapshot.nodes.filter(
        (node): node is SemanticLearnedWordNode =>
          isLearnedNode(node) && node.anchorId === selectedNode.id
      );
    }

    return snapshot.nodes.filter(
      (node): node is SemanticLearnedWordNode =>
        isLearnedNode(node) && node.anchorId === selectedNode.anchorId
    );
  }, [selectedNode, snapshot]);

  useEffect(() => {
    if (!graphData || !graphRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      graphRef.current?.zoomToFit?.(350, 64);
    }, 120);

    graphRef.current?.d3Force?.("charge")?.strength?.(-95);
    graphRef.current?.d3Force?.("link")?.distance?.((link: GraphLink) =>
      link.kind === "anchor" ? 50 : 26
    );
    graphRef.current?.d3Force?.("center")?.strength?.(0.08);

    return () => window.clearTimeout(timer);
  }, [graphData]);

  useEffect(() => {
    if (!containerRef.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = Math.max(320, Math.floor(entries[0]?.contentRect.width ?? 900));
      setGraphWidth(nextWidth);
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <Card>
      <SectionHeading
        title="Semantic map"
        description="Navigate how meanings cluster together. Anchor concepts stay large, while learned words appear as smaller nodes inside that shape."
      />

      {!graphData ? (
        <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50 px-6 py-12">
          <h3 className="text-lg font-semibold text-ink-900">No semantic snapshot imported yet</h3>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-ink-500">
            Populate `dashboard/semantic-data/*.input.json`, run the Python generator, and write
            the resulting snapshots into the semantic snapshot files. Until then, this map stays
            intentionally empty.
          </p>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
          <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex flex-wrap items-center gap-4 text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                  Anchor meanings
                </span>
                <span className="inline-flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-ink-500" />
                  Learned words
                </span>
              </div>
              <Button variant="secondary" onClick={() => graphRef.current?.zoomToFit?.(350, 64)}>
                Reset view
              </Button>
            </div>

            <div
              ref={containerRef}
              className="h-[28rem] overflow-hidden rounded-xl border border-ink-100 bg-white"
            >
              <ForceGraph3D
                ref={graphRef}
                graphData={graphData}
                width={graphWidth}
                height={448}
                numDimensions={3}
                cooldownTicks={120}
                warmupTicks={80}
                backgroundColor="#ffffff"
                enableNodeDrag
                showNavInfo={false}
                linkOpacity={0.36}
                linkColor={(link) =>
                  (link as GraphLink).kind === "anchor" ? "rgba(148, 163, 184, 0.55)" : "rgba(148, 163, 184, 0.18)"
                }
                linkWidth={(link) => ((link as GraphLink).kind === "anchor" ? 1.2 : 0.45)}
                linkDirectionalParticles={(link) => ((link as GraphLink).kind === "anchor" ? 0 : 0)}
                nodeVal={(node) => (node as GraphNode).val}
                nodeColor={(node) => {
                  const typedNode = node as GraphNode;
                  if (typedNode.id === selectedNodeId) {
                    return typedNode.kind === "anchor" ? "#64748b" : "#334155";
                  }

                  if (typedNode.id === hoveredNodeId) {
                    return typedNode.kind === "anchor" ? "#a8b4c3" : "#7c90a7";
                  }

                  return typedNode.color;
                }}
                nodeOpacity={0.96}
                nodeResolution={18}
                nodeLabel={(node) => (node as GraphNode).label}
                onNodeClick={(node) => {
                  const typedNode = node as GraphNode;
                  onSelectNode(typedNode);

                  const distance = typedNode.kind === "anchor" ? 90 : 65;
                  const magnitude = Math.hypot(typedNode.x ?? 0, typedNode.y ?? 0, typedNode.z ?? 0) || 1;
                  const distanceRatio = 1 + distance / magnitude;

                  graphRef.current?.cameraPosition?.(
                    {
                      x: (typedNode.x ?? 0) * distanceRatio,
                      y: (typedNode.y ?? 0) * distanceRatio,
                      z: (typedNode.z ?? 0) * distanceRatio,
                    },
                    typedNode,
                    800
                  );
                }}
                onBackgroundClick={() => onSelectNode(null)}
                onNodeHover={(node) => setHoveredNodeId((node as GraphNode | null)?.id ?? null)}
                nodeVisibility={() => true}
                nodeRelSize={4}
              />
            </div>
            <p className="mt-3 px-1 text-sm text-ink-500">
              Orbit, pan, and zoom with the mouse. Hover to preview a label, then click any node to
              lock the details panel and recenter the camera.
            </p>
          </div>

          <div className="rounded-xl border border-ink-100 bg-ink-50/50 p-5">
            {!selectedNode ? (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
                  Node details
                </p>
                <h3 className="mt-3 text-lg font-semibold text-ink-900">Select a node to inspect it</h3>
                <p className="mt-3 text-sm leading-7 text-ink-500">
                  Click any anchor or learned-word node to reveal its definition and nearby related
                  vocabulary.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
                  Node details
                </p>
                <div className="mt-3 flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-semibold text-ink-900">{selectedNode.label}</h3>
                    <p className="mt-2 text-sm text-ink-500">
                      {selectedNode.kind === "anchor" ? "Anchor meaning" : "Learned word"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium",
                      selectedNode.kind === "anchor"
                        ? "border-accent-200 bg-accent-50 text-accent-700"
                        : "border-ink-200 bg-white text-ink-700"
                    )}
                  >
                    {selectedNode.kind === "anchor" ? "Anchor" : "Learned"}
                  </span>
                </div>

                <p className="mt-4 text-sm leading-7 text-ink-600">
                  {selectedNode.kind === "anchor"
                    ? selectedNode.definition
                    : selectedNode.definition || "No definition has been imported for this learned word yet."}
                </p>

                {selectedNode.kind === "learned-word" ? (
                  <div className="mt-4 rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-600">
                    <div className="flex justify-between gap-3">
                      <span>Language</span>
                      <strong className="text-ink-900">
                        {languageLabels[selectedNode.languageCode] ?? selectedNode.languageCode.toUpperCase()}
                      </strong>
                    </div>
                    <div className="flex justify-between gap-3">
                      <span>Source word</span>
                      <strong className="text-ink-900">{selectedNode.sourceWord}</strong>
                    </div>
                    <div className="mt-2 flex justify-between gap-3">
                      <span>Learned word</span>
                      <strong className="text-ink-900">{selectedNode.learnedWord}</strong>
                    </div>
                    <div className="mt-2 flex justify-between gap-3">
                      <span>Anchor</span>
                      <strong className="text-ink-900">{selectedNode.anchorId}</strong>
                    </div>
                  </div>
                ) : null}

                <div className="mt-5">
                  <p className="text-sm font-semibold text-ink-900">
                    Related learned words ({relatedLearnedNodes.length})
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {relatedLearnedNodes.length === 0 ? (
                      <p className="text-sm leading-6 text-ink-500">
                        No learned-word nodes are linked to this area yet.
                      </p>
                    ) : (
                      relatedLearnedNodes.slice(0, 12).map((node) => (
                        <button
                          key={node.id}
                          type="button"
                          onClick={() => onSelectNode(node)}
                          className="rounded-full border border-ink-200 bg-white px-3 py-1 text-sm text-ink-700 transition hover:border-ink-300 hover:text-ink-900"
                        >
                          {node.learnedWord}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
