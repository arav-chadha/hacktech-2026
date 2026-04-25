# Fetch.ai / ASI:One Setup

This project uses Fetch.ai's ASI:One API for phrase selection and Gemma for phrase translation.

## What the extension does with ASI:One

1. The content script extracts phrase candidates from paragraph text nodes.
2. The local backend sends those candidates to ASI:One.
3. ASI:One returns a strict JSON object containing the selected phrase ids.
4. The backend translates only those selected phrases.
5. The extension swaps the selected DOM spans with translated text.

If `ASI_ONE_API_KEY` is empty, the backend falls back to a heuristic selector so the extension still runs.

## Create an ASI:One API key

1. Open the ASI:One developer platform.
   `https://docs.asi1.ai/documentation/getting-started/quickstart`
2. Create an API key from the developer section.
3. Keep the key local. Do not put it in the extension bundle.

## Configure the local backend

Update [server/local-config.js](/Users/arseniysherstnev/Documents/github/hacktech-2026/server/local-config.js):

```js
export const LOCAL_GEMMA_API_KEY = "your-gemma-key";
export const ASI_ONE_API_KEY = "your-asi-one-key";
export const ASI_ONE_MODEL = "asi1-mini";
export const SERVER_PORT = 8787;
```

`ASI_ONE_MODEL` defaults to `asi1-mini`, which is the model this backend targets for structured phrase selection.

## API contract used by this project

The backend calls:

`POST https://api.asi1.ai/v1/chat/completions`

Headers:

- `Authorization: Bearer <ASI_ONE_API_KEY>`
- `Content-Type: application/json`

The request uses a JSON-schema response format so phrase selection is machine-parseable. The server expects:

```json
{
  "selected_ids": ["p0-n0-c1", "p0-n1-c0"]
}
```

## Start the project

1. Install dependencies.
   `npm install`
2. Start the local backend.
   `npm run server`
3. Build the extension.
   `npm run build`
4. Load `dist/` as an unpacked extension in Chrome.

## Verify ASI:One is being used

With a valid `ASI_ONE_API_KEY` configured:

- the backend response includes `"selectionMode":"asi1"`
- phrase selection is ratio-controlled by `readerKnowledgeLevel`

Without a key:

- the backend response includes `"selectionMode":"heuristic"`

## Reader knowledge mapping

The extension currently maps reader level to translated phrase coverage like this:

- `1 -> 25%`
- `2 -> 50%`
- `3 -> 75%`

This is implemented in [src/shared/settings.js](/Users/arseniysherstnev/Documents/github/hacktech-2026/src/shared/settings.js).
