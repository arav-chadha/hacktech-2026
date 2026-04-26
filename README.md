# WordLoom - Hacktech 2026

Arav Chadha, Mason Lam, Arseniy Sherstnev, Peter Ma

WordLoom is a language-learning browser extension that helps users learn while reading the web. It incrementally translates English words and phrases into a target language, lets users reveal meaning in context, and adapts difficulty over time using stored learning data.

## What It Does

- Translates parts of real web pages instead of forcing full-page translation immediately.
- Adjusts translation difficulty across levels such as `beginner`, `elementary`, `intermediate`, `advanced`, and `fluent`.
- Tracks EXP and language progress in MongoDB so the extension can personalize difficulty.
- Lets users inspect translated words with an in-page lookup card.
- Supports pronunciation audio playback for translated words.
- Exposes dashboard APIs for progress overview, vocabulary history, settings, and semantic/discovery features.

## Project Structure

- `src/`
  - React extension popup UI
  - background service worker
  - content script that processes paragraphs and injects translated text into pages
  - shared translation/settings logic
- `server/`
  - local Node backend
  - OpenAI-powered translation pipeline
  - MongoDB learning/analytics storage
  - lookup, audio, EXP, and dashboard endpoints

## Core Flow

1. The extension popup loads the user's selected language and Mongo-backed EXP/level.
2. The content script scans page paragraphs and sends them to the local backend.
3. The backend builds a translation prompt based on the user's current translation level and stored learning signals.
4. OpenAI returns structured translated text, which is rebuilt into inject-ready HTML and streamed back into the page.
5. The user interacts with translated words to reveal meaning, hear pronunciation, and generate learning signals.
6. WordLoom stores analytics and EXP so later translations can become more personalized and more difficult.

## Tech Stack

- Chrome Extension (Manifest V3)
- React
- Vite
- Node.js
- OpenAI API
- Gemma API
- MongoDB
- ElevenLabs API

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local config file:

```bash
cp server/local-config.example.js server/local-config.js
```

3. Add the keys you want to use in `server/local-config.js`:

- `LOCAL_OPENAI_API_KEY`
- `LOCAL_GEMINI_API_KEY`
- `MONGODB_URI`
- `LOCAL_ELEVENLABS_API_KEY`
- dashboard auth/session values

4. Start the backend:

```bash
npm run server
```

5. Build the extension:

```bash
npm run build
```

6. Load the built extension in Chrome:
- Open `chrome://extensions/`
- Enable Developer Mode
- Click `Load unpacked`
- Select the repo's `dist/` folder

## Development Notes

- Rebuild the extension after frontend changes with `npm run build`.
- Restart the backend after server or config changes with `npm run server`.
- Reload the unpacked extension in Chrome after rebuilding.
- The backend runs locally on `127.0.0.1:8787`.

## Current Backend Capabilities

- Translation endpoint with adaptive prompting
- Word feedback and EXP tracking
- Mongo-backed language profile lookup
- Dictionary/lookup endpoint
- Pronunciation audio endpoint
- Dashboard auth, settings, overview, vocabulary, and semantic-map routes

## Summary

WordLoom turns normal browsing into passive language practice. Instead of asking users to leave the page and study flashcards separately, it gradually weaves another language into the reading experience, tracks how the user responds, and increases difficulty as they improve.
