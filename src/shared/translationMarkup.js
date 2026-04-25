export const MARKER_PREFIX = "SEG_";
const MARKER_TOKEN_SOURCE = /\[\[(\/?SEG_\d+)\]\]/g;

export function normalizeWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function normalizeMarkerizedText(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function stripTrailingPartialMarker(text) {
  const markerStartIndex = text.lastIndexOf("[[");
  if (markerStartIndex === -1) {
    return text;
  }

  const markerEndIndex = text.indexOf("]]", markerStartIndex);
  if (markerEndIndex !== -1) {
    return text;
  }

  return text.slice(0, markerStartIndex);
}

function escapeHtml(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function joinNormalizedParts(parts) {
  return normalizeWhitespace(parts.filter(Boolean).join(" "));
}

function isStructuredSegment(value) {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof value.start_tag === "string" &&
    typeof value.end_tag === "string" &&
    Array.isArray(value.splitText)
  );
}

export function buildRawTextFromSplitText(splitText) {
  if (!Array.isArray(splitText)) {
    return "";
  }

  return joinNormalizedParts(
    splitText.map((part) => {
      if (typeof part === "string") {
        return normalizeWhitespace(part);
      }

      if (!isStructuredSegment(part)) {
        return "";
      }

      return buildRawTextFromSplitText(part.splitText);
    })
  );
}

export function buildMarkerizedTextFromSplitText(splitText) {
  const segmentMetadata = [];
  let markerIndex = 1;

  function visit(parts, parentId = null) {
    if (!Array.isArray(parts)) {
      return "";
    }

    const renderedParts = [];

    for (const part of parts) {
      if (typeof part === "string") {
        const normalizedText = normalizeWhitespace(part);
        if (normalizedText) {
          renderedParts.push(normalizedText);
        }
        continue;
      }

      if (!isStructuredSegment(part)) {
        continue;
      }

      const id = `${MARKER_PREFIX}${markerIndex}`;
      markerIndex += 1;

      segmentMetadata.push({
        id,
        parentId,
        startTag: part.start_tag,
        endTag: part.end_tag,
      });

      const childText = visit(part.splitText, id);
      renderedParts.push(`[[${id}]]${childText}[[/${id}]]`);
    }

    return joinNormalizedParts(renderedParts);
  }

  return {
    markerizedText: visit(splitText),
    segments: segmentMetadata,
  };
}

export function parseTranslatedMarkerizedText(translatedText, segments) {
  const normalizedText = normalizeMarkerizedText(translatedText);
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));
  const markerPattern = new RegExp(MARKER_TOKEN_SOURCE);
  const seenMarkers = new Set();
  const root = { type: "root", children: [] };
  const stack = [{ node: root, parentChildren: null, index: -1 }];
  let cursor = 0;

  function appendText(target, text) {
    if (!text) {
      return;
    }

    const children = target.children;
    const previousChild = children[children.length - 1];
    if (previousChild?.type === "text") {
      previousChild.text += text;
      return;
    }

    children.push({ type: "text", text });
  }

  function serializeNodes(nodes) {
    return nodes
      .map((node) => {
        if (node.type === "text") {
          return node.text;
        }

        if (node.type === "segment") {
          return `[[${node.id}]]${serializeNodes(node.children)}[[/${node.id}]]`;
        }

        return "";
      })
      .join("");
  }

  let match;
  while ((match = markerPattern.exec(normalizedText)) !== null) {
    appendText(stack[stack.length - 1].node, normalizedText.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const token = match[1];
    const isClosingToken = token.startsWith("/");
    const markerId = isClosingToken ? token.slice(1) : token;
    const segment = segmentMap.get(markerId);

    if (!segment) {
      return {
        ok: false,
        error: `Unknown marker ${markerId}.`,
      };
    }

    if (!isClosingToken) {
      if (seenMarkers.has(`open:${markerId}`)) {
        return {
          ok: false,
          error: `Marker ${markerId} was opened more than once.`,
        };
      }

      const currentParent = stack[stack.length - 1].node;
      const currentParentId =
        currentParent.type === "segment" ? currentParent.id : null;

      if (segment.parentId !== currentParentId) {
        return {
          ok: false,
          error: `Marker ${markerId} changed nesting relative to the original HTML.`,
        };
      }

      const node = {
        type: "segment",
        id: markerId,
        children: [],
      };

      const parentChildren = currentParent.children;
      parentChildren.push(node);
      stack.push({
        node,
        parentChildren,
        index: parentChildren.length - 1,
      });
      seenMarkers.add(`open:${markerId}`);
      continue;
    }

    const currentSegment = stack[stack.length - 1].node;
    if (currentSegment.type !== "segment" || currentSegment.id !== markerId) {
      return {
        ok: false,
        error: `Marker ${markerId} closed out of order.`,
      };
    }

    if (seenMarkers.has(`close:${markerId}`)) {
      return {
        ok: false,
        error: `Marker ${markerId} was closed more than once.`,
      };
    }

    stack.pop();
    seenMarkers.add(`close:${markerId}`);
  }

  appendText(
    stack[stack.length - 1].node,
    stripTrailingPartialMarker(normalizedText.slice(cursor))
  );

  if (stack.length !== 1) {
    const firstUnclosedFrame = stack[1];
    firstUnclosedFrame.parentChildren.splice(firstUnclosedFrame.index);
  }

  const completedText = normalizeMarkerizedText(serializeNodes(root.children));

  return {
    ok: true,
    complete:
      stack.length === 1 &&
      segments.every(
        ({ id }) => seenMarkers.has(`open:${id}`) && seenMarkers.has(`close:${id}`)
      ),
    normalizedText: completedText,
    tree: root.children,
  };
}

export function buildPlainTextFromParsedMarkers(nodes) {
  return normalizeWhitespace(
    nodes
      .map((node) => {
        if (node.type === "text") {
          return node.text;
        }

        if (node.type === "segment") {
          return buildPlainTextFromParsedMarkers(node.children);
        }

        return "";
      })
      .join("")
  );
}

export function reconstructHtmlFromParsedMarkers(nodes, segments) {
  const segmentMap = new Map(segments.map((segment) => [segment.id, segment]));

  function render(renderNodes) {
    return renderNodes
      .map((node) => {
        if (node.type === "text") {
          return escapeHtml(node.text);
        }

        if (node.type === "segment") {
          const segment = segmentMap.get(node.id);
          if (!segment) {
            throw new Error(`Missing segment metadata for ${node.id}.`);
          }

          return `${segment.startTag}${render(node.children)}${segment.endTag}`;
        }

        return "";
      })
      .join("");
  }

  return render(nodes);
}
