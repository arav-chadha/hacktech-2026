"use client";

import dynamic from "next/dynamic";
import { createPortal } from "react-dom";
import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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

type GraphMode = "inline" | "modal";

type GraphNode = SemanticGraphNode & {
  color: string;
  size: number;
};

type GraphLink = {
  source: string;
  target: string;
  kind: "anchor" | "semantic-neighbor";
};

type GraphData = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type GraphSize = {
  width: number;
  height: number;
};

type GraphViewportApi = {
  resetView: (duration?: number) => void;
  focusNodeById: (nodeId: string, duration?: number) => void;
};

type LanguageColorEntry = {
  code: string;
  label: string;
  color: string;
};

type MapStyleState = {
  anchorSize: number;
  learnedSize: number;
  anchorLineWidth: number;
  neighborLineWidth: number;
  cameraDistance: number;
  anchorLabelFontSize: number;
  learnedLabelFontSize: number;
  hoverLabelFontSize: number;
  labelCardScale: number;
  labelYOffset: number;
  showAnchorLabels: boolean;
  showLearnedLabels: boolean;
  languageColors: Record<string, string>;
};

const ANCHOR_COLOR = "#94a3b8";

const DEFAULT_LANGUAGE_COLORS: Record<string, string> = {
  es: "#ef4444",
  fr: "#2563eb",
  de: "#f59e0b",
  ja: "#10b981",
};

const DEFAULT_MAP_STYLES: MapStyleState = {
  anchorSize: 17.8,
  learnedSize: 8.4,
  anchorLineWidth: 3,
  neighborLineWidth: 1.6,
  cameraDistance: 152,
  anchorLabelFontSize: 168,
  learnedLabelFontSize: 84,
  hoverLabelFontSize: 40,
  labelCardScale: 2,
  labelYOffset: 0,
  showAnchorLabels: true,
  showLearnedLabels: true,
  languageColors: DEFAULT_LANGUAGE_COLORS,
};

function isAnchorNode(node: SemanticGraphNode): node is SemanticAnchorNode {
  return node.kind === "anchor";
}

function isLearnedNode(node: SemanticGraphNode): node is SemanticLearnedWordNode {
  return node.kind === "learned-word";
}

function useBodyScrollLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [enabled]);
}

function useEscapeKey(enabled: boolean, onEscape: () => void) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onEscape();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, onEscape]);
}

function useElementSize<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
  fallback: GraphSize
) {
  const [size, setSize] = useState<GraphSize>(fallback);

  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      setSize({
        width: Math.max(320, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height)),
      });
    });

    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [fallback.height, fallback.width, ref]);

  return size;
}

function buildTextSprite(text: string, fontSize: number, color: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.font = `600 ${fontSize}px "Segoe UI Variable", "Aptos", sans-serif`;
  const metrics = context.measureText(text);
  const width = Math.max(90, Math.ceil(metrics.width + 38));
  const height = Math.max(48, Math.ceil(fontSize * 2));

  canvas.width = width;
  canvas.height = height;

  const drawContext = canvas.getContext("2d");
  if (!drawContext) {
    return null;
  }

  drawContext.font = `600 ${fontSize}px "Segoe UI Variable", "Aptos", sans-serif`;
  drawContext.fillStyle = "rgba(255, 255, 255, 0.94)";
  drawContext.strokeStyle = "rgba(219, 228, 238, 0.98)";
  drawContext.lineWidth = 2;
  drawContext.beginPath();
  drawContext.roundRect(1, 1, width - 2, height - 2, 12);
  drawContext.fill();
  drawContext.stroke();
  drawContext.fillStyle = color;
  drawContext.textAlign = "center";
  drawContext.textBaseline = "middle";
  drawContext.fillText(text, width / 2, height / 2);

  const texture = new CanvasTexture(canvas);
  texture.needsUpdate = true;

  const material = new SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });

  const sprite = new Sprite(material);
  sprite.scale.set(width / 16, height / 16, 1);
  return sprite;
}

function buildGraphData(snapshot: SemanticGraphSnapshot | null, mapStyles: MapStyleState): GraphData | null {
  if (!snapshot) {
    return null;
  }

  const nodes: GraphNode[] = snapshot.nodes.map((node) => ({
    ...node,
    color:
      node.kind === "anchor"
        ? ANCHOR_COLOR
        : mapStyles.languageColors[node.languageCode] ?? "#64748b",
    size: node.kind === "anchor" ? mapStyles.anchorSize : mapStyles.learnedSize,
  }));

  const links: GraphLink[] = snapshot.links.map((link) => ({
    source: link.source,
    target: link.target,
    kind: snapshot.nodes.some(
      (node) =>
        node.kind === "learned-word" &&
        node.id === link.target &&
        node.anchorId === link.source
    )
      ? "anchor"
      : "semantic-neighbor",
  }));

  return { nodes, links };
}

function SemanticMapToolbar({
  languageColorEntries,
  isStylePanelOpen,
  onToggleStylePanel,
  onResetView,
  mode,
  onOpenFullscreen,
  onCloseFullscreen,
}: {
  languageColorEntries: LanguageColorEntry[];
  isStylePanelOpen: boolean;
  onToggleStylePanel: () => void;
  onResetView: () => void;
  mode: GraphMode;
  onOpenFullscreen: () => void;
  onCloseFullscreen: () => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
      <div className="flex flex-wrap items-center gap-4 text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
        <span className="inline-flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          Anchor meanings
        </span>
        {languageColorEntries.map((entry) => (
          <span key={entry.code} className="inline-flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            {entry.label}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" onClick={onToggleStylePanel}>
          {isStylePanelOpen ? "Close style menu" : "Map style"}
        </Button>
        <Button variant="secondary" onClick={onResetView}>
          Reset view
        </Button>
        {mode === "inline" ? (
          <Button variant="secondary" onClick={onOpenFullscreen}>
            Fullscreen
          </Button>
        ) : (
          <Button variant="secondary" onClick={onCloseFullscreen}>
            Close
          </Button>
        )}
      </div>
    </div>
  );
}

function SemanticMapStylePanel({
  mapStyles,
  setMapStyles,
  languageColorEntries,
}: {
  mapStyles: MapStyleState;
  setMapStyles: React.Dispatch<React.SetStateAction<MapStyleState>>;
  languageColorEntries: LanguageColorEntry[];
}) {
  return (
    <div className="mb-4 rounded-xl border border-ink-100 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-900">Map appearance</p>
          <p className="mt-1 text-sm text-ink-500">
            Tune persistent anchor text, point size, line weight, and camera framing. Hover labels
            stay separate from the always-on anchor labels.
          </p>
        </div>
        <Button variant="ghost" onClick={() => setMapStyles(DEFAULT_MAP_STYLES)}>
          Reset styles
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Anchor point size</span>
          <input
            type="range"
            min="5"
            max="14"
            step="0.2"
            value={mapStyles.anchorSize}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                anchorSize: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Learned point size</span>
          <input
            type="range"
            min="2.5"
            max="10"
            step="0.2"
            value={mapStyles.learnedSize}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                learnedSize: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Persistent anchor label size</span>
          <input
            type="range"
            min="18"
            max="42"
            step="1"
            value={mapStyles.anchorLabelFontSize}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                anchorLabelFontSize: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Persistent learned label size</span>
          <input
            type="range"
            min="12"
            max="32"
            step="1"
            value={mapStyles.learnedLabelFontSize}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                learnedLabelFontSize: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Hover and selected label size</span>
          <input
            type="range"
            min="16"
            max="34"
            step="1"
            value={mapStyles.hoverLabelFontSize}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                hoverLabelFontSize: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Camera distance</span>
          <input
            type="range"
            min="44"
            max="130"
            step="1"
            value={mapStyles.cameraDistance}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                cameraDistance: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Anchor line thickness</span>
          <input
            type="range"
            min="0.6"
            max="4"
            step="0.1"
            value={mapStyles.anchorLineWidth}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                anchorLineWidth: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="block text-sm text-ink-700">
          <span className="mb-2 block font-medium">Neighbor line thickness</span>
          <input
            type="range"
            min="0.3"
            max="3"
            step="0.1"
            value={mapStyles.neighborLineWidth}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                neighborLineWidth: Number(event.target.value),
              }))
            }
            className="w-full"
          />
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={mapStyles.showAnchorLabels}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                showAnchorLabels: event.target.checked,
              }))
            }
          />
          Show always-on anchor labels
        </label>

        <label className="flex items-center gap-3 rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm font-medium text-ink-700">
          <input
            type="checkbox"
            checked={mapStyles.showLearnedLabels}
            onChange={(event) =>
              setMapStyles((current) => ({
                ...current,
                showLearnedLabels: event.target.checked,
              }))
            }
          />
          Show always-on learned labels
        </label>
      </div>

      {languageColorEntries.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {languageColorEntries.map((entry) => (
            <label
              key={entry.code}
              className="rounded-xl border border-ink-100 bg-ink-50 px-4 py-3 text-sm text-ink-700"
            >
              <span className="mb-2 block font-medium">{entry.label}</span>
              <input
                type="color"
                value={entry.color}
                onChange={(event) =>
                  setMapStyles((current) => ({
                    ...current,
                    languageColors: {
                      ...current.languageColors,
                      [entry.code]: event.target.value,
                    },
                  }))
                }
                className="h-10 w-full rounded-lg border border-ink-200 bg-white"
              />
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SemanticNodeDetailsPanel({
  selectedNode,
  relatedLearnedNodes,
  languageLabels,
  onSelectNode,
  className,
}: {
  selectedNode: SemanticGraphNode | null;
  relatedLearnedNodes: SemanticLearnedWordNode[];
  languageLabels: Record<string, string>;
  onSelectNode: (node: SemanticGraphNode | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("rounded-xl border border-ink-100 bg-ink-50/50 p-5", className)}>
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
              <div className="mt-2 flex justify-between gap-3">
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
  );
}

function SemanticGraphCanvas({
  mode,
  graphData,
  selectedNodeId,
  onSelectNode,
  mapStyles,
  registerApi,
}: {
  mode: GraphMode;
  graphData: GraphData;
  selectedNodeId: string | null;
  onSelectNode: (node: SemanticGraphNode | null) => void;
  mapStyles: MapStyleState;
  registerApi: (api: GraphViewportApi | null) => void;
}) {
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const { width, height } = useElementSize(
    containerRef,
    mode === "modal" ? { width: 1100, height: 640 } : { width: 900, height: 560 }
  );

  const focusNode = useCallback(
    (node: GraphNode | null, duration = 720) => {
      if (!node || !graphRef.current) {
        return;
      }

      const camera = graphRef.current.camera?.();
      const controls = graphRef.current.controls?.();
      const target = new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
      const currentTarget = controls?.target
        ? new Vector3(controls.target.x, controls.target.y, controls.target.z)
        : target.clone();
      const direction = camera
        ? new Vector3().subVectors(camera.position, currentTarget)
        : new Vector3(1, 0.45, 1);

      if (direction.lengthSq() === 0) {
        direction.set(1, 0.45, 1);
      }

      direction.normalize();

      const aspectRatio = width / Math.max(1, height);
      const aspectScale = aspectRatio < 1.25 ? 1.16 : aspectRatio > 1.7 ? 0.96 : 1;
      const modeScale = mode === "modal" ? 0.96 : 1.02;
      const distance =
        (mapStyles.cameraDistance + (node.kind === "anchor" ? 12 : 0)) * aspectScale * modeScale;

      const nextPosition = target.clone().add(direction.multiplyScalar(distance));

      graphRef.current.cameraPosition(
        {
          x: nextPosition.x,
          y: nextPosition.y,
          z: nextPosition.z,
        },
        {
          x: target.x,
          y: target.y,
          z: target.z,
        },
        duration
      );
    },
    [height, mapStyles.cameraDistance, mode, width]
  );

  const resetView = useCallback(
    (duration = 450) => {
      graphRef.current?.zoomToFit?.(duration, mode === "modal" ? 92 : 72);
    },
    [mode]
  );

  useEffect(() => {
    registerApi({
      resetView,
      focusNodeById(nodeId, duration = 720) {
        const node = graphData.nodes.find((entry) => entry.id === nodeId) ?? null;
        focusNode(node, duration);
      },
    });

    return () => registerApi(null);
  }, [focusNode, graphData.nodes, registerApi, resetView]);

  useEffect(() => {
    if (!graphRef.current) {
      return;
    }

    graphRef.current?.d3Force?.("charge")?.strength?.(-95);
    graphRef.current?.d3Force?.("link")?.distance?.((link: GraphLink) =>
      link.kind === "anchor" ? 56 : 30
    );
    graphRef.current?.d3Force?.("center")?.strength?.(0.12);

    const timer = window.setTimeout(() => {
      if (selectedNodeId) {
        const node = graphData.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
        if (node) {
          focusNode(node, 0);
          return;
        }
      }

      resetView(0);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [focusNode, graphData, height, resetView, selectedNodeId, width]);

  useEffect(() => {
    if (!selectedNodeId) {
      return;
    }

    const node = graphData.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
    if (!node) {
      return;
    }

    focusNode(node);
  }, [focusNode, graphData.nodes, selectedNodeId]);

  return (
    <div ref={containerRef} className="flex-1 overflow-hidden rounded-xl border border-ink-100 bg-white">
      <ForceGraph3D
        ref={graphRef}
        graphData={graphData}
        width={width}
        height={height}
        numDimensions={3}
        cooldownTicks={120}
        warmupTicks={80}
        backgroundColor="#ffffff"
        enableNodeDrag
        showNavInfo={false}
        linkOpacity={0.38}
        linkColor={(link) =>
          (link as GraphLink).kind === "anchor"
            ? "rgba(148, 163, 184, 0.64)"
            : "rgba(148, 163, 184, 0.22)"
        }
        linkWidth={(link) =>
          (link as GraphLink).kind === "anchor"
            ? mapStyles.anchorLineWidth
            : mapStyles.neighborLineWidth
        }
        nodeLabel={(node) => (node as GraphNode).label}
        nodeThreeObject={(node) => {
          const typedNode = node as GraphNode;
          const group = new Group();
          const isSelected = typedNode.id === selectedNodeId;
          const isHovered = typedNode.id === hoveredNodeId;
          const sphere = new Mesh(
            new SphereGeometry(
              typedNode.size * (isSelected ? 1.22 : isHovered ? 1.1 : 1),
              18,
              18
            ),
            new MeshBasicMaterial({
              color:
                isSelected
                  ? typedNode.kind === "anchor"
                    ? "#64748b"
                    : "#1f2937"
                  : isHovered
                    ? typedNode.kind === "anchor"
                      ? "#b0bac6"
                      : "#4b5563"
                    : typedNode.color,
              transparent: true,
              opacity: 0.98,
            })
          );
          group.add(sphere);

          const shouldShowLabel =
            (typedNode.kind === "anchor" && mapStyles.showAnchorLabels) ||
            (typedNode.kind === "learned-word" && mapStyles.showLearnedLabels) ||
            isSelected ||
            isHovered;

          if (shouldShowLabel) {
            const sprite = buildTextSprite(
              typedNode.label,
              typedNode.kind === "anchor"
                ? mapStyles.anchorLabelFontSize
                : typedNode.kind === "learned-word" && mapStyles.showLearnedLabels
                  ? mapStyles.learnedLabelFontSize
                  : mapStyles.hoverLabelFontSize,
              "#0f172a"
            );

            if (sprite) {
              sprite.position.set(0, typedNode.size + (typedNode.kind === "anchor" ? 3.2 : 2.4), 0);
              group.add(sprite);
            }
          }

          return group;
        }}
        onNodeClick={(node: object) => onSelectNode(node as GraphNode)}
        onBackgroundClick={() => onSelectNode(null)}
        onNodeHover={(node) => setHoveredNodeId((node as GraphNode | null)?.id ?? null)}
      />
    </div>
  );
}

function SemanticMapViewport({
  mode,
  graphData,
  selectedNode,
  selectedNodeId,
  relatedLearnedNodes,
  languageColorEntries,
  languageLabels,
  mapStyles,
  setMapStyles,
  isStylePanelOpen,
  onToggleStylePanel,
  onSelectNode,
  onOpenFullscreen,
  onCloseFullscreen,
}: {
  mode: GraphMode;
  graphData: GraphData;
  selectedNode: SemanticGraphNode | null;
  selectedNodeId: string | null;
  relatedLearnedNodes: SemanticLearnedWordNode[];
  languageColorEntries: LanguageColorEntry[];
  languageLabels: Record<string, string>;
  mapStyles: MapStyleState;
  setMapStyles: React.Dispatch<React.SetStateAction<MapStyleState>>;
  isStylePanelOpen: boolean;
  onToggleStylePanel: () => void;
  onSelectNode: (node: SemanticGraphNode | null) => void;
  onOpenFullscreen: () => void;
  onCloseFullscreen: () => void;
}) {
  const graphApiRef = useRef<GraphViewportApi | null>(null);

  return (
    <div
      className={cn(
        "grid gap-5",
        mode === "modal"
          ? "flex-1 min-h-0 xl:grid-cols-[minmax(0,1.8fr)_minmax(22rem,0.72fr)]"
          : "xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]"
      )}
    >
      <div className="flex min-h-0 flex-col rounded-xl border border-ink-100 bg-ink-50/60 p-3">
        <SemanticMapToolbar
          languageColorEntries={languageColorEntries}
          isStylePanelOpen={isStylePanelOpen}
          onToggleStylePanel={onToggleStylePanel}
          onResetView={() => graphApiRef.current?.resetView()}
          mode={mode}
          onOpenFullscreen={onOpenFullscreen}
          onCloseFullscreen={onCloseFullscreen}
        />

        {isStylePanelOpen ? (
          <SemanticMapStylePanel
            mapStyles={mapStyles}
            setMapStyles={setMapStyles}
            languageColorEntries={languageColorEntries}
          />
        ) : null}

        <div className={cn("flex min-h-0 flex-1 flex-col", mode === "modal" ? "min-h-[30rem]" : "min-h-[34rem]")}>
          <SemanticGraphCanvas
            mode={mode}
            graphData={graphData}
            selectedNodeId={selectedNodeId}
            onSelectNode={onSelectNode}
            mapStyles={mapStyles}
            registerApi={(api) => {
              graphApiRef.current = api;
            }}
          />
        </div>

        <p className="mt-3 px-1 text-sm text-ink-500">
          Orbit, pan, and zoom with the mouse. Focus and reset use the active graph viewport, and
          the always-on anchor labels are sized separately from hover labels.
        </p>
      </div>

      <SemanticNodeDetailsPanel
        selectedNode={selectedNode}
        relatedLearnedNodes={relatedLearnedNodes}
        languageLabels={languageLabels}
        onSelectNode={onSelectNode}
        className={cn(mode === "modal" && "min-h-0 overflow-y-auto")}
      />
    </div>
  );
}

function SemanticMapInlineCard(props: {
  graphData: GraphData | null;
  selectedNode: SemanticGraphNode | null;
  selectedNodeId: string | null;
  relatedLearnedNodes: SemanticLearnedWordNode[];
  languageColorEntries: LanguageColorEntry[];
  languageLabels: Record<string, string>;
  mapStyles: MapStyleState;
  setMapStyles: React.Dispatch<React.SetStateAction<MapStyleState>>;
  isStylePanelOpen: boolean;
  onToggleStylePanel: () => void;
  onSelectNode: (node: SemanticGraphNode | null) => void;
  onOpenFullscreen: () => void;
}) {
  const {
    graphData,
    selectedNode,
    selectedNodeId,
    relatedLearnedNodes,
    languageColorEntries,
    languageLabels,
    mapStyles,
    setMapStyles,
    isStylePanelOpen,
    onToggleStylePanel,
    onSelectNode,
    onOpenFullscreen,
  } = props;

  return (
    <Card>
      <SectionHeading
        title="Semantic map"
        description="Navigate how meanings cluster together. Anchor concepts stay visible, while learned words respond to the active vocabulary filters above."
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
        <SemanticMapViewport
          mode="inline"
          graphData={graphData}
          selectedNode={selectedNode}
          selectedNodeId={selectedNodeId}
          relatedLearnedNodes={relatedLearnedNodes}
          languageColorEntries={languageColorEntries}
          languageLabels={languageLabels}
          mapStyles={mapStyles}
          setMapStyles={setMapStyles}
          isStylePanelOpen={isStylePanelOpen}
          onToggleStylePanel={onToggleStylePanel}
          onSelectNode={onSelectNode}
          onOpenFullscreen={onOpenFullscreen}
          onCloseFullscreen={() => undefined}
        />
      )}
    </Card>
  );
}

function SemanticMapOverlay(props: {
  isOpen: boolean;
  graphData: GraphData | null;
  selectedNode: SemanticGraphNode | null;
  selectedNodeId: string | null;
  relatedLearnedNodes: SemanticLearnedWordNode[];
  languageColorEntries: LanguageColorEntry[];
  languageLabels: Record<string, string>;
  mapStyles: MapStyleState;
  setMapStyles: React.Dispatch<React.SetStateAction<MapStyleState>>;
  isStylePanelOpen: boolean;
  onToggleStylePanel: () => void;
  onSelectNode: (node: SemanticGraphNode | null) => void;
  onClose: () => void;
}) {
  const {
    isOpen,
    graphData,
    selectedNode,
    selectedNodeId,
    relatedLearnedNodes,
    languageColorEntries,
    languageLabels,
    mapStyles,
    setMapStyles,
    isStylePanelOpen,
    onToggleStylePanel,
    onSelectNode,
    onClose,
  } = props;

  useBodyScrollLock(isOpen);
  useEscapeKey(isOpen, onClose);

  if (!isOpen || !graphData) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-label="Close semantic map fullscreen"
        onClick={onClose}
        className="absolute inset-0 bg-ink-900/18 backdrop-blur-[2px]"
      />

      <div
        className="relative z-10 h-[min(88vh,960px)] w-full max-w-[1500px]"
        onClick={(event) => event.stopPropagation()}
      >
        <Card className="flex h-full flex-col p-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <SectionHeading
              title="Semantic map"
              description="Explore the semantic map in a focused fullscreen view while keeping node details visible beside the graph."
            />
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>

          <SemanticMapViewport
            mode="modal"
            graphData={graphData}
            selectedNode={selectedNode}
            selectedNodeId={selectedNodeId}
            relatedLearnedNodes={relatedLearnedNodes}
            languageColorEntries={languageColorEntries}
            languageLabels={languageLabels}
            mapStyles={mapStyles}
            setMapStyles={setMapStyles}
            isStylePanelOpen={isStylePanelOpen}
            onToggleStylePanel={onToggleStylePanel}
            onSelectNode={onSelectNode}
            onOpenFullscreen={() => undefined}
            onCloseFullscreen={onClose}
          />
        </Card>
      </div>
    </div>,
    document.body
  );
}

export function SemanticMapCard({
  snapshot,
  selectedNodeId,
  languageLabels,
  onSelectNode,
}: SemanticMapCardProps) {
  const [isFullscreenOpen, setIsFullscreenOpen] = useState(false);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(false);
  const [mapStyles, setMapStyles] = useState<MapStyleState>(DEFAULT_MAP_STYLES);

  const graphData = useMemo(() => buildGraphData(snapshot, mapStyles), [mapStyles, snapshot]);

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

  const languageColorEntries = useMemo(() => {
    const learnedLanguageCodes = Array.from(
      new Set(
        snapshot?.nodes
          .filter((node): node is SemanticLearnedWordNode => node.kind === "learned-word")
          .map((node) => node.languageCode) ?? []
      )
    );

    return learnedLanguageCodes.map((code) => ({
      code,
      label: languageLabels[code] ?? code.toUpperCase(),
      color: mapStyles.languageColors[code] ?? "#64748b",
    }));
  }, [languageLabels, mapStyles.languageColors, snapshot]);

  return (
    <>
      <SemanticMapInlineCard
        graphData={graphData}
        selectedNode={selectedNode}
        selectedNodeId={selectedNodeId}
        relatedLearnedNodes={relatedLearnedNodes}
        languageColorEntries={languageColorEntries}
        languageLabels={languageLabels}
        mapStyles={mapStyles}
        setMapStyles={setMapStyles}
        isStylePanelOpen={isStylePanelOpen}
        onToggleStylePanel={() => setIsStylePanelOpen((current) => !current)}
        onSelectNode={onSelectNode}
        onOpenFullscreen={() => setIsFullscreenOpen(true)}
      />

      <SemanticMapOverlay
        isOpen={isFullscreenOpen}
        graphData={graphData}
        selectedNode={selectedNode}
        selectedNodeId={selectedNodeId}
        relatedLearnedNodes={relatedLearnedNodes}
        languageColorEntries={languageColorEntries}
        languageLabels={languageLabels}
        mapStyles={mapStyles}
        setMapStyles={setMapStyles}
        isStylePanelOpen={isStylePanelOpen}
        onToggleStylePanel={() => setIsStylePanelOpen((current) => !current)}
        onSelectNode={onSelectNode}
        onClose={() => setIsFullscreenOpen(false)}
      />
    </>
  );
}
