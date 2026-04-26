#!/usr/bin/env python3
"""
Generate a semantic-map snapshot JSON file from a simple input file.

Recommended Python dependencies:
    pip install openai numpy umap-learn

Usage examples:
    python generate_semantic_snapshot.py \
        --input dashboard/semantic-data/anchor-meanings.input.json \
        --output dashboard/src/lib/data/semantic/anchor-meanings.snapshot.json \
        --kind anchor

    python generate_semantic_snapshot.py \
        --input dashboard/semantic-data/learned-words.input.json \
        --output dashboard/src/lib/data/semantic/learned-words.snapshot.json \
        --kind learned-word

This utility is intentionally offline and portable. It does not depend on the app
server or any database. Later, backend ingestion can import the same input files
or generated snapshots.
"""

from __future__ import annotations

import argparse
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
from openai import OpenAI

try:
    import umap
except ImportError as exc:  # pragma: no cover - environment-dependent
    raise SystemExit(
        "Missing dependency 'umap-learn'. Install it with: pip install umap-learn"
    ) from exc


EMBEDDING_MODEL = "text-embedding-3-small"
EXPECTED_EMBEDDING_DIMENSIONS = 1536
SCHEMA_VERSION = 2
DEFAULT_BATCH_SIZE = 64


@dataclass
class ProjectionConfig:
    algorithm: str = "umap"
    dimensions: int = 3
    random_seed: int = 42


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate semantic snapshot JSON.")
    parser.add_argument("--input", required=True, help="Path to input JSON file.")
    parser.add_argument("--output", required=True, help="Path to output snapshot JSON file.")
    parser.add_argument(
        "--kind",
        required=True,
        choices=["anchor", "learned-word"],
        help="Semantic node kind to generate.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=DEFAULT_BATCH_SIZE,
        help="Number of items to send per embeddings request.",
    )
    parser.add_argument(
        "--api-key",
        default=os.getenv("OPENAI_API_KEY", ""),
        help="OpenAI API key. Defaults to OPENAI_API_KEY env var.",
    )
    return parser.parse_args()


def load_input(path: Path, expected_kind: str) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, dict):
        raise ValueError("Input file must contain an object.")
    if raw.get("kind") != expected_kind:
        raise ValueError(f"Input kind must be '{expected_kind}'.")
    items = raw.get("items")
    if not isinstance(items, list):
        raise ValueError("Input file must contain an 'items' array.")
    return items


def validate_item(item: dict[str, Any], kind: str) -> None:
    required_fields = {
        "anchor": ["id", "label", "definition"],
        "learned-word": ["id", "sourceWord", "learnedWord", "languageCode", "anchorId"],
    }[kind]

    missing_fields = [field for field in required_fields if not str(item.get(field, "")).strip()]
    if missing_fields:
        raise ValueError(
            f"Item is missing required fields {missing_fields}: {json.dumps(item, ensure_ascii=False)}"
        )


def build_embedding_text(item: dict[str, Any], kind: str) -> str:
    if kind == "anchor":
        parts = [
            str(item["label"]).strip(),
            str(item["definition"]).strip(),
            " ".join(str(tag).strip() for tag in item.get("tags", []) if str(tag).strip()),
        ]
        return "\n".join(part for part in parts if part)

    parts = [
        str(item["sourceWord"]).strip(),
        str(item["learnedWord"]).strip(),
        str(item.get("definition", "")).strip(),
        f"anchor:{str(item['anchorId']).strip()}",
        f"language:{str(item['languageCode']).strip()}",
    ]
    return "\n".join(part for part in parts if part)


def chunk_items(items: list[Any], batch_size: int) -> list[list[Any]]:
    return [items[index : index + batch_size] for index in range(0, len(items), batch_size)]


def fetch_embeddings(
    client: OpenAI,
    texts: list[str],
    batch_size: int,
) -> list[list[float]]:
    embeddings: list[list[float]] = []

    for batch in chunk_items(texts, batch_size):
        response = client.embeddings.create(
            model=EMBEDDING_MODEL,
            input=batch,
            encoding_format="float",
        )
        for data_item in response.data:
            vector = data_item.embedding
            if not isinstance(vector, list) or not vector:
                raise ValueError("Embeddings API returned an invalid vector.")
            if len(vector) != EXPECTED_EMBEDDING_DIMENSIONS:
                raise ValueError(
                    f"Expected {EXPECTED_EMBEDDING_DIMENSIONS} dimensions, got {len(vector)}."
                )
            if not all(isinstance(value, (int, float)) and math.isfinite(value) for value in vector):
                raise ValueError("Embedding vector contains non-numeric or non-finite values.")
            embeddings.append([float(value) for value in vector])

    return embeddings


def project_embeddings(
    embeddings: list[list[float]], config: ProjectionConfig
) -> list[tuple[float, float, float]]:
    if len(embeddings) == 0:
        return []
    if len(embeddings) == 1:
        return [(0.0, 0.0, 0.0)]
    if len(embeddings) == 2:
        return [(-1.0, 0.0, 0.0), (1.0, 0.0, 0.0)]

    matrix = np.array(embeddings, dtype=np.float32)
    reducer = umap.UMAP(
        n_components=config.dimensions,
        n_neighbors=max(2, min(15, len(embeddings) - 1)),
        min_dist=0.18,
        metric="cosine",
        random_state=config.random_seed,
    )
    projection = reducer.fit_transform(matrix)
    return [(float(point[0]), float(point[1]), float(point[2])) for point in projection]


def build_output_nodes(
    items: list[dict[str, Any]],
    positions: list[tuple[float, float, float]],
    embeddings: list[list[float]],
    kind: str,
) -> list[dict[str, Any]]:
    nodes: list[dict[str, Any]] = []

    for item, (x, y, z), embedding in zip(items, positions, embeddings):
        if kind == "anchor":
            nodes.append(
                {
                    "id": str(item["id"]).strip(),
                    "kind": "anchor",
                    "label": str(item["label"]).strip(),
                    "definition": str(item["definition"]).strip(),
                    "x": x,
                    "y": y,
                    "z": z,
                    "embedding": embedding,
                    "tags": item.get("tags", []),
                    "notes": item.get("notes"),
                }
            )
            continue

        label = str(item.get("label") or item["learnedWord"]).strip()
        nodes.append(
            {
                "id": str(item["id"]).strip(),
                "kind": "learned-word",
                "label": label,
                "sourceWord": str(item["sourceWord"]).strip(),
                "learnedWord": str(item["learnedWord"]).strip(),
                "languageCode": str(item["languageCode"]).strip(),
                "anchorId": str(item["anchorId"]).strip(),
                "definition": str(item.get("definition", "")).strip() or None,
                "status": item.get("status"),
                "level": item.get("level"),
                "x": x,
                "y": y,
                "z": z,
                "embedding": embedding,
            }
        )

    return nodes


def write_output(
    output_path: Path,
    nodes: list[dict[str, Any]],
    config: ProjectionConfig,
) -> None:
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "embeddingModel": EMBEDDING_MODEL if nodes else None,
        "embeddingDimensions": EXPECTED_EMBEDDING_DIMENSIONS if nodes else None,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "projection": {
            "algorithm": config.algorithm,
            "dimensions": config.dimensions,
            "randomSeed": config.random_seed,
        }
        if nodes
        else None,
        "nodes": nodes,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    if not args.api_key:
        raise SystemExit("OPENAI_API_KEY is required. Set it in your environment or pass --api-key.")

    input_path = Path(args.input)
    output_path = Path(args.output)

    items = load_input(input_path, args.kind)
    for item in items:
        validate_item(item, args.kind)

    if not items:
        write_output(output_path, [], ProjectionConfig())
        print(f"Wrote empty snapshot to {output_path}")
        return

    texts = [build_embedding_text(item, args.kind) for item in items]
    client = OpenAI(api_key=args.api_key)
    embeddings = fetch_embeddings(client, texts, args.batch_size)
    projection_config = ProjectionConfig()
    positions = project_embeddings(embeddings, projection_config)
    nodes = build_output_nodes(items, positions, embeddings, args.kind)
    # BACKEND_INTEGRATION: Keep this standalone snapshot generator portable so a future backend
    # ingestion job can either import these snapshots directly or reproduce the same contract.
    write_output(output_path, nodes, projection_config)
    print(f"Wrote {len(nodes)} nodes to {output_path}")


if __name__ == "__main__":
    main()
