# Semantic Data Contracts

These files are intentionally empty by default so the dashboard can ship without seeded semantic-map content.

## Input files

- `anchor-meanings.input.json`
  - human-managed list of general English meaning anchors
- `learned-words.input.json`
  - human-managed or pipeline-managed list of learned-word semantic entries

Both input files use this outer shape:

```json
{
  "schemaVersion": 1,
  "kind": "anchor or learned-word",
  "items": []
}
```

### Anchor item fields

```json
{
  "id": "travel",
  "label": "travel",
  "definition": "the act of going from one place to another",
  "tags": ["movement", "daily-life"],
  "notes": "optional freeform note"
}
```

### Learned-word item fields

```json
{
  "id": "es-viaje",
  "sourceWord": "journey",
  "learnedWord": "viaje",
  "languageCode": "es",
  "anchorId": "travel",
  "definition": "a trip from one place to another",
  "status": "Practicing",
  "level": "Beginner"
}
```

## Generated snapshot files

The dashboard reads empty-by-default snapshot JSON from:

- `src/lib/data/semantic/anchor-meanings.snapshot.json`
- `src/lib/data/semantic/learned-words.snapshot.json`

Populate those files by running `generate_semantic_snapshot.py` somewhere with Python, OpenAI access, and the dependencies installed.

Generated snapshots now preserve:

- 3D UMAP coordinates (`x`, `y`, `z`)
- the full embedding vector on each node for downstream similarity graph building
