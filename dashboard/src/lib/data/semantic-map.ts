import anchorSnapshot from "@/lib/data/semantic/anchor-meanings.snapshot.json";
import learnedSnapshot from "@/lib/data/semantic/learned-words.snapshot.json";
import type {
  SemanticAnchorNode,
  SemanticEmbeddingVector,
  SemanticGraphLink,
  SemanticGraphNode,
  SemanticGraphSnapshot,
  SemanticLearnedWordNode,
  SemanticProjectionMetadata,
} from "@/lib/types/dashboard";

type SnapshotJson = {
  schemaVersion?: number;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
  generatedAt?: string | null;
  projection?: SemanticProjectionMetadata | null;
  nodes?: unknown[];
};

function isFiniteCoordinate(value: unknown) {
  return typeof value === "number" && Number.isFinite(value);
}

function normalizeEmbedding(value: unknown): SemanticEmbeddingVector | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }

  const normalized = value.filter(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
  );

  return normalized.length === value.length ? normalized : undefined;
}

function normalizeAnchorNode(node: any): SemanticAnchorNode | null {
  if (
    !node ||
    node.kind !== "anchor" ||
    typeof node.id !== "string" ||
    typeof node.label !== "string" ||
    typeof node.definition !== "string" ||
    !isFiniteCoordinate(node.x) ||
    !isFiniteCoordinate(node.y)
  ) {
    return null;
  }

  return {
    id: node.id,
    kind: "anchor",
    label: node.label,
    definition: node.definition,
    x: node.x,
    y: node.y,
    z: isFiniteCoordinate(node.z) ? node.z : 0,
    embedding: normalizeEmbedding(node.embedding),
    tags: Array.isArray(node.tags)
      ? node.tags.filter((tag: unknown): tag is string => typeof tag === "string")
      : undefined,
    notes: typeof node.notes === "string" ? node.notes : undefined,
  };
}

function normalizeLearnedNode(node: any): SemanticLearnedWordNode | null {
  if (
    !node ||
    node.kind !== "learned-word" ||
    typeof node.id !== "string" ||
    typeof node.sourceWord !== "string" ||
    typeof node.learnedWord !== "string" ||
    typeof node.languageCode !== "string" ||
    typeof node.anchorId !== "string" ||
    !isFiniteCoordinate(node.x) ||
    !isFiniteCoordinate(node.y)
  ) {
    return null;
  }

  return {
    id: node.id,
    kind: "learned-word",
    label: typeof node.label === "string" && node.label ? node.label : node.learnedWord,
    sourceWord: node.sourceWord,
    learnedWord: node.learnedWord,
    languageCode: node.languageCode,
    anchorId: node.anchorId,
    x: node.x,
    y: node.y,
    z: isFiniteCoordinate(node.z) ? node.z : 0,
    embedding: normalizeEmbedding(node.embedding),
    definition: typeof node.definition === "string" && node.definition ? node.definition : undefined,
    status: typeof node.status === "string" ? node.status : undefined,
    level: typeof node.level === "string" ? node.level : undefined,
  };
}

function parseSnapshotNodes(snapshot: SnapshotJson): SemanticGraphNode[] {
  const rawNodes = Array.isArray(snapshot.nodes) ? snapshot.nodes : [];

  return rawNodes
    .map((node) => {
      if (node && typeof node === "object" && (node as any).kind === "anchor") {
        return normalizeAnchorNode(node);
      }

      if (node && typeof node === "object" && (node as any).kind === "learned-word") {
        return normalizeLearnedNode(node);
      }

      return null;
    })
    .filter((node): node is SemanticGraphNode => Boolean(node));
}

function cosineSimilarity(left: SemanticEmbeddingVector, right: SemanticEmbeddingVector): number {
  let dotProduct = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dotProduct += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }

  if (leftMagnitude === 0 || rightMagnitude === 0) {
    return -1;
  }

  return dotProduct / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}

function inverseDistanceSimilarity(left: SemanticGraphNode, right: SemanticGraphNode): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  const dz = left.z - right.z;
  return 1 / (1 + Math.sqrt(dx * dx + dy * dy + dz * dz));
}

function measureSemanticSimilarity(left: SemanticLearnedWordNode, right: SemanticLearnedWordNode): number {
  if (
    left.embedding &&
    right.embedding &&
    left.embedding.length === right.embedding.length &&
    left.embedding.length > 0
  ) {
    return cosineSimilarity(left.embedding, right.embedding);
  }

  return inverseDistanceSimilarity(left, right);
}

function buildLinks(nodes: SemanticGraphNode[]): SemanticGraphLink[] {
  const anchorIds = new Set(nodes.filter((node) => node.kind === "anchor").map((node) => node.id));
  const linkKeys = new Set<string>();
  const links: SemanticGraphLink[] = [];

  function pushLink(source: string, target: string) {
    if (source === target) {
      return;
    }

    const [first, second] = [source, target].sort();
    const key = `${first}__${second}`;
    if (linkKeys.has(key)) {
      return;
    }

    linkKeys.add(key);
    links.push({ source, target });
  }

  nodes
    .filter((node): node is SemanticLearnedWordNode => node.kind === "learned-word")
    .filter((node) => anchorIds.has(node.anchorId))
    .forEach((node) => {
      pushLink(node.anchorId, node.id);
    });

  const learnedNodes = nodes.filter(
    (node): node is SemanticLearnedWordNode => node.kind === "learned-word"
  );
  const neighborCount = Math.min(4, Math.max(1, learnedNodes.length - 1));

  learnedNodes.forEach((node) => {
    const nearestNeighbors = learnedNodes
      .filter((candidate) => candidate.id !== node.id)
      .map((candidate) => ({
        id: candidate.id,
        score: measureSemanticSimilarity(node, candidate),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, neighborCount);

    nearestNeighbors.forEach((neighbor) => {
      pushLink(node.id, neighbor.id);
    });
  });

  return links;
}

export function loadSemanticGraphSnapshot(): SemanticGraphSnapshot | null {
  const anchorNodes = parseSnapshotNodes(anchorSnapshot as SnapshotJson);
  const learnedNodes = parseSnapshotNodes(learnedSnapshot as SnapshotJson);
  const nodes = [...anchorNodes, ...learnedNodes];

  if (nodes.length === 0) {
    return null;
  }

  // This local snapshot helper remains available for offline semantic-map development,
  // but the live dashboard now asks the Node backend for semantic graph data.
  const links = buildLinks(nodes);

  return {
    schemaVersion:
      typeof learnedSnapshot.schemaVersion === "number"
        ? learnedSnapshot.schemaVersion
        : typeof anchorSnapshot.schemaVersion === "number"
          ? anchorSnapshot.schemaVersion
          : 1,
    embeddingModel: learnedSnapshot.embeddingModel ?? anchorSnapshot.embeddingModel ?? null,
    embeddingDimensions:
      learnedSnapshot.embeddingDimensions ?? anchorSnapshot.embeddingDimensions ?? null,
    generatedAt: learnedSnapshot.generatedAt ?? anchorSnapshot.generatedAt ?? null,
    projection: learnedSnapshot.projection ?? anchorSnapshot.projection ?? null,
    nodes,
    links,
  };
}
