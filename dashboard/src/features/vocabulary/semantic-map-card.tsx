"use client";

import dynamic from "next/dynamic";
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
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  color: string;
  size: number;
};

type GraphLink = {
  source: string;
  target: string;
  kind: "anchor" | "semantic-neighbor";
};

type MapStyleState = {
  anchorSize: number;
  learnedSize: number;
  anchorLineWidth: number;
  neighborLineWidth: number;
  cameraDistance: number;
  anchorLabelFontSize: number;
  hoverLabelFontSize: number;
  labelCardScale: number;
  labelYOffset: number;
  showAnchorLabels: boolean;
  languageColors: Record<string, string>;
};

const DEFAULT_LANGUAGE_COLORS: Record<string, string> = {
  es: "#ef4444",
  fr: "#2563eb",
  de: "#f59e0b",
  ja: "#10b981",
};

const DEFAULT_MAP_STYLES: MapStyleState = {
  anchorSize: 8.9,
  learnedSize: 4.2,
  anchorLineWidth: 1.5,
  neighborLineWidth: 0.8,
  cameraDistance: 76,
  anchorLabelFontSize: 28,
  hoverLabelFontSize: 20,
  labelCardScale: 6,
  labelYOffset: 0,
  showAnchorLabels: true,
  languageColors: DEFAULT_LANGUAGE_COLORS,
};

type OverlayMetrics = {
  top: number;
  left: number;
  width: number;
  height: number;
};

function isAnchorNode(node: SemanticGraphNode): node is SemanticAnchorNode {
  return node.kind === "anchor";
}

function isLearnedNode(node: SemanticGraphNode): node is SemanticLearnedWordNode {
  return node.kind === "learned-word";
}

function buildTextSprite(text: string, fontSize: number, color: string) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    return null;
  }

  context.font = `600 ${fontSize}px "Segoe UI Variable", "Aptos", sans-serif`;
  const metrics = context.measureText(text);
  const width = Math.max(84, Math.ceil(metrics.width + 36));
  const height = Math.max(44, Math.ceil(fontSize * 1.95));

  canvas.width = width;
  canvas.height = height;

  const drawContext = canvas.getContext("2d");
  if (!drawContext) {
    return null;
  }

  drawContext.font = `600 ${fontSize}px "Segoe UI Variable", "Aptos", sans-serif`;
  drawContext.fillStyle = "rgba(255, 255, 255, 0.92)";
  drawContext.strokeStyle = "rgba(219, 228, 238, 0.95)";
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

export function SemanticMapCard({
  snapshot,
  selectedNodeId,
  languageLabels,
  onSelectNode,
}: SemanticMapCardProps) {
  const graphRef = useRef<any>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [graphWidth, setGraphWidth] = useState(900);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isStylePanelOpen, setIsStylePanelOpen] = useState(false);
  const [mapStyles, setMapStyles] = useState<MapStyleState>(DEFAULT_MAP_STYLES);
  const [overlayMetrics, setOverlayMetrics] = useState<OverlayMetrics | null>(null);

  const graphHeight = isExpanded ? overlayMetrics?.height ?? 760 : 520;
  const graphViewportHeight = isExpanded
    ? Math.max(420, graphHeight - (isStylePanelOpen ? 340 : 220))
    : 520;
  const anchorBaseColor = "#94a3b8";

  const graphData = useMemo(() => {
    if (!snapshot) {
      return null;
    }

    const nodes: GraphNode[] = snapshot.nodes.map((node) => ({
      ...node,
      color:
        node.kind === "anchor"
          ? anchorBaseColor
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
  }, [mapStyles.anchorSize, mapStyles.languageColors, mapStyles.learnedSize, snapshot]);

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

  function updateOverlayMetrics() {
    if (typeof window === "undefined") {
      return;
    }

    const anchorRect = wrapperRef.current?.getBoundingClientRect();
    const top = Math.max(24, Math.min(anchorRect?.top ?? 96, 180));
    const availableWidth = Math.max(960, window.innerWidth - 40);
    const width = Math.min(availableWidth, 1600);
    const left = Math.max(20, (window.innerWidth - width) / 2);
    const height = Math.max(560, window.innerHeight - top - 24);

    setOverlayMetrics({
      top,
      left,
      width,
      height,
    });
  }

  function focusNode(node: GraphNode | null, duration = 800) {
    if (!node || !graphRef.current) {
      return;
    }

    const camera = graphRef.current.camera?.();
    const controls = graphRef.current.controls?.();
    const targetVector = new Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0);
    const controlsTarget = controls?.target
      ? new Vector3(controls.target.x, controls.target.y, controls.target.z)
      : targetVector.clone();
    const currentDirection =
      camera && controls
        ? new Vector3().subVectors(camera.position, controlsTarget).normalize()
        : new Vector3(1, 0.45, 1).normalize();
    const distanceScale = graphWidth > graphHeight ? 1 : 1.12;
    const distance =
      (mapStyles.cameraDistance + (node.kind === "anchor" ? 14 : 0)) * distanceScale;
    const nextPosition = targetVector
      .clone()
      .add(currentDirection.multiplyScalar(distance));

    graphRef.current.cameraPosition(
      {
        x: nextPosition.x,
        y: nextPosition.y,
        z: nextPosition.z,
      },
      {
        x: targetVector.x,
        y: targetVector.y,
        z: targetVector.z,
      },
      duration
    );
  }

  function resetView() {
    graphRef.current?.zoomToFit?.(450, 72);
  }

  useEffect(() => {
    if (!graphData || !graphRef.current) {
      return;
    }

    const timer = window.setTimeout(() => {
      resetView();
    }, 120);

    graphRef.current?.d3Force?.("charge")?.strength?.(-95);
    graphRef.current?.d3Force?.("link")?.distance?.((link: GraphLink) =>
      link.kind === "anchor" ? 52 : 28
    );
    graphRef.current?.d3Force?.("center")?.strength?.(0.12);

    return () => window.clearTimeout(timer);
  }, [graphData, graphHeight, graphWidth]);

  useEffect(() => {
    if (!isExpanded) {
      return;
    }

    updateOverlayMetrics();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const sync = () => updateOverlayMetrics();
    window.addEventListener("resize", sync);
    window.addEventListener("scroll", sync, true);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", sync);
      window.removeEventListener("scroll", sync, true);
    };
  }, [isExpanded]);

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

  useEffect(() => {
    if (!graphData || !selectedNodeId) {
      return;
    }

    const node = graphData.nodes.find((entry) => entry.id === selectedNodeId) ?? null;
    focusNode(node, 720);
  }, [graphData, mapStyles.cameraDistance, selectedNodeId]);

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

  function renderGraphLayout(inOverlay: boolean) {
    return (
      <Card className={cn(inOverlay && "h-full p-6")}>
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
          <div
            className={cn(
              "grid gap-5",
              inOverlay
                ? "xl:grid-cols-[minmax(0,1.8fr)_minmax(21rem,0.7fr)]"
                : "xl:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]"
            )}
          >
            <div className="rounded-xl border border-ink-100 bg-ink-50/60 p-3">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3 px-1">
                <div className="flex flex-wrap items-center gap-4 text-xs font-medium uppercase tracking-[0.14em] text-ink-500">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    Anchor meanings
                  </span>
                  {languageColorEntries.map((entry) => (
                    <span key={entry.code} className="inline-flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: entry.color }}
                      />
                      {entry.label}
                    </span>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="ghost" onClick={() => setIsStylePanelOpen((current) => !current)}>
                    {isStylePanelOpen ? "Close style menu" : "Map style"}
                  </Button>
                  <Button variant="secondary" onClick={resetView}>
                    Reset view
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      if (inOverlay) {
                        setIsExpanded(false);
                        return;
                      }

                      updateOverlayMetrics();
                      setIsExpanded(true);
                    }}
                  >
                    {inOverlay ? "Exit fullscreen" : "Fullscreen"}
                  </Button>
                </div>
              </div>

              {isStylePanelOpen ? (
                <div className="mb-4 rounded-xl border border-ink-100 bg-white p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink-900">Map appearance</p>
                      <p className="mt-1 text-sm text-ink-500">
                        Tune persistent anchor text, point size, line weight, and camera framing
                        without changing the hover labels.
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
                      <span className="mb-2 block font-medium">Hover and selected label size</span>
                      <input
                        type="range"
                        min="16"
                        max="32"
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
                      <span className="mb-2 block font-medium">Label card scale</span>
                      <input
                        type="range"
                        min="2"
                        max="10"
                        step="0.05"
                        value={mapStyles.labelCardScale}
                        onChange={(event) =>
                          setMapStyles((current) => ({
                            ...current,
                            labelCardScale: Number(event.target.value),
                          }))
                        }
                        className="w-full"
                      />
                    </label>

                    <label className="block text-sm text-ink-700">
                      <span className="mb-2 block font-medium">Label distance from node</span>
                      <input
                        type="range"
                        min="0"
                        max="14"
                        step="0.2"
                        value={mapStyles.labelYOffset}
                        onChange={(event) =>
                          setMapStyles((current) => ({
                            ...current,
                            labelYOffset: Number(event.target.value),
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
              ) : null}

              <div
                ref={containerRef}
                className="overflow-hidden rounded-xl border border-ink-100 bg-white"
                style={{ height: `${graphViewportHeight}px` }}
              >
                <ForceGraph3D
                  ref={graphRef}
                  graphData={graphData}
                  width={graphWidth}
                  height={graphViewportHeight}
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
                      : "rgba(148, 163, 184, 0.2)"
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
                      isSelected ||
                      isHovered;

                    if (shouldShowLabel) {
                      const sprite = buildTextSprite(
                        typedNode.label,
                        typedNode.kind === "anchor"
                          ? mapStyles.anchorLabelFontSize
                          : mapStyles.hoverLabelFontSize,
                        "#0f172a"
                      );

                      if (sprite) {
                        const cardScale = mapStyles.labelCardScale;
                        sprite.scale.set(sprite.scale.x * cardScale, sprite.scale.y * cardScale, 1);

                        const baseOffset = typedNode.kind === "anchor" ? 3.1 : 2.4;
                        sprite.position.set(
                          0,
                          typedNode.size + baseOffset + mapStyles.labelYOffset,
                          0
                        );
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
              <p className="mt-3 px-1 text-sm text-ink-500">
                Orbit, pan, and zoom with the mouse. Focus and reset now use the graph pane’s real
                viewport, and the always-on anchor labels can be resized separately from hover text.
              </p>
            </div>

            <div
              className={cn(
                "rounded-xl border border-ink-100 bg-ink-50/50 p-5",
                inOverlay && "min-h-0"
              )}
            >
              {!selectedNode ? (
                <>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
                    Node details
                  </p>
                  <h3 className="mt-3 text-lg font-semibold text-ink-900">
                    Select a node to inspect it
                  </h3>
                  <p className="mt-3 text-sm leading-7 text-ink-500">
                    Click any anchor or learned-word node to reveal its definition and nearby
                    related vocabulary.
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
                      : selectedNode.definition ||
                        "No definition has been imported for this learned word yet."}
                  </p>

                  {selectedNode.kind === "learned-word" ? (
                    <div className="mt-4 rounded-xl border border-ink-100 bg-white p-4 text-sm text-ink-600">
                      <div className="flex justify-between gap-3">
                        <span>Language</span>
                        <strong className="text-ink-900">
                          {languageLabels[selectedNode.languageCode] ??
                            selectedNode.languageCode.toUpperCase()}
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
          </div>
        )}
      </Card>
    );
  }

  return (
    <div ref={wrapperRef} className="relative">
      {isExpanded ? <div className="h-[38rem]" /> : renderGraphLayout(false)}

      {isExpanded && overlayMetrics
        ? createPortal(
            <>
              <div
                className="fixed bottom-6 z-40 rounded-2xl bg-ink-900/10 backdrop-blur-[1px]"
                style={{
                  top: overlayMetrics.top - 8,
                  left: overlayMetrics.left,
                  width: overlayMetrics.width,
                }}
              />
              <div
                className="fixed z-50"
                style={{
                  top: overlayMetrics.top,
                  left: overlayMetrics.left,
                  width: overlayMetrics.width,
                  height: overlayMetrics.height,
                }}
              >
                {renderGraphLayout(true)}
              </div>
            </>,
            document.body
          )
        : null}
    </div>
  );
}
