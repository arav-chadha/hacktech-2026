# Language Extension

A Chrome extension that detects phrase candidates on a page, uses Fetch.ai ASI:One to choose which ones to translate based on the reader's knowledge level, translates the selected phrases, and swaps them into the live DOM.

## Setup

1. Install dependencies.

   ```bash
   npm install
   ```

2. Configure local keys in [server/local-config.js](/Users/arseniysherstnev/Documents/github/hacktech-2026/server/local-config.js).

   ```js
   export const LOCAL_GEMMA_API_KEY = "your-gemma-key";
   export const ASI_ONE_API_KEY = "your-asi-one-key";
   export const ASI_ONE_MODEL = "asi1-mini";
   export const SERVER_PORT = 8787;
   ```

3. Start the backend.

   ```bash
   npm run server
   ```

4. Build the extension.

   ```bash
   npm run build
   ```

5. Load the extension in Chrome.
   - Open `chrome://extensions/`
   - Enable Developer mode
   - Click Load unpacked
   - Select the `dist/` folder

## Reader levels

Reader knowledge level controls how many detected phrases are translated:

- `1 -> 25%`
- `2 -> 50%`
- `3 -> 75%`

## Fetch.ai integration

Detailed ASI:One setup instructions live in [FETCH_AI_SETUP.md](/Users/arseniysherstnev/Documents/github/hacktech-2026/FETCH_AI_SETUP.md).

If `ASI_ONE_API_KEY` is not configured, the backend falls back to a heuristic phrase selector.

## Development

- Run `npm run server` for the local backend
- Run `npm run build` after source changes
- Reload the unpacked extension in Chrome after rebuilding
