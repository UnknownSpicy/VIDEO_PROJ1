# SIM PROJ1 — Field Station 01

A playable browser prototype for a small 3D world inhabited by three characters. You are an observer with intervention tools: inspect the crew, send messages, deliver supplies, and change the weather. The shared task is to restore the antenna before nightfall.

## Run

Requires **Node.js 24+** and npm. From this checkout:

```sh
npm ci --cache /tmp/sim-proj1-npm-cache
npm run dev
```

Vite serves the browser app on port **5173** and proxies `/api` to the Node server on port **3001**. Keep both processes running. The startup command respects the environment's configured HTTPS proxy and retains TLS verification. No API key is needed for local mode.

For a production build served by the Node server:

```sh
npm run build
npm start
```

The built app is then served on port **3001**. This prototype is intended for a local or access-controlled development environment; add user authentication and per-user budgets before exposing a funded AI endpoint publicly.

## Play

- Drag to orbit, scroll to zoom, right-drag to pan. **R** resets the camera.
- **Space** pauses/resumes. Set speed to 1×, 2×, or 4×.
- Click a character, or open **Characters**, to inspect their needs, intentions, relationships, and memories.
- Send messages from the character inspector. Local mode recognizes basic food/rest/help requests and uses simple canned replies; it is explicitly not an LLM.
- **Intervene** delivers food or introduces/clears a storm. Storms slow outdoor repairs and travel.
- Open **Event journal** to follow conversations and interventions.
- Settings provides browser-local save/load and portable JSON export/import. Saves include the simulation, memories, relationships, and journal; they do not include keys or AI settings. Imports load paused.
- The six-minute simulation day runs from 08:00 to 18:00. Restore the antenna to win; nightfall closes the experiment. Reset to try another approach.

## Optional OpenRouter connection

Supply **OPENROUTER_API_KEY** securely through your cloud environment settings, or copy `.env.example` to an ignored `.env` for local development and fill it there. Never put keys in a `VITE_` variable, commit them, or enter them in chat. Restart the API process after changing configuration.

Optional non-secret setting: `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`). The browser settings panel also lets you select a model by its OpenRouter ID. Select **OpenRouter** after the server detects a key. Use a model that supports JSON output. Account credits and HTTPS access to `openrouter.ai` are required.

Live mode is **hybrid**, not a model call for every action. At most one character gets a model decision every eight real seconds, rotating across the crew. Routine actions continue through local rules between decisions and when a request fails. The server allows a maximum of 120 requests per hour per process, one concurrent request, and a 20-second provider timeout. It caps model output at 250 tokens. These are request limits, not a dollar-denominated spending cap.

The model receives a character's personality, goal, needs, inventory, current task status, nearby people, recent memories, and observer message. It chooses a validated action (`move`, `repair`, `eat`, `rest`, `talk`, or `give`). World code owns navigation, inventory, repair, and action execution. Model output is untrusted: unsupported actions and malformed responses are rejected. A request error is shown in settings and the world continues with local behavior. Pausing, resetting, importing, or intervening invalidates stale in-flight decisions.

This version uses structured observations, not visual perception or audio. It keeps short event memories rather than a vector database or unrestricted agent tools. It contains no multiplayer or external tool execution.

## Checks

```sh
npm test              # simulation and API tests
npm run build         # TypeScript validation and production bundle
npm run test:browser  # desktop/mobile Playwright playtests and screenshots
```

Browser tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to another Chromium executable if needed. Screenshots go to ignored `artifacts/`.

## Code map

- `src/engine.ts`: serializable simulation, movement routing, actions, observations, interventions, validated save loading.
- `src/contracts.ts`: shared runtime schemas for observations and model decisions.
- `src/World.tsx`: procedural 3D scene, character animation, camera controls, rendering fallback.
- `src/App.tsx`: observer UI, simulation clock, save tools, live-decision scheduling.
- `server/app.ts`: optional OpenRouter adapter, validation, timeouts and request budget; serves the production build.
- `tests/`: simulation/API checks and browser playtests.

Art and geometry are generated in code. Fonts are bundled locally. No external models or texture downloads are required. Work in the existing checkout; cloud tasks are already isolated, so no additional Git worktree is needed.
