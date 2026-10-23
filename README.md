# SIM PROJ1 — Field Station 01

A playable browser prototype for a small 3D world inhabited by three characters. You are an observer with intervention tools: inspect the crew, talk to them, deliver supplies, change the weather, and watch relationships or conflict develop. The default shared task is to restore the antenna before nightfall.

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
- Send messages from the character inspector. Replies appear in the journal and as conversation bubbles above the speaker. Local mode recognizes basic greetings, food/rest/help requests, and named instructions; it is explicitly not an LLM.
- Characters can move, repair, eat, rest, talk, share food, and punch. Punches cause damage, reduce trust, enter memories, and can provoke retaliation. A character at zero health is knocked out.
- **Intervene** delivers food or introduces/clears a storm. Storms slow outdoor repairs and travel.
- Open **Event journal** to follow conversations and interventions.
- Settings lets you edit the world's current situation plus each character's personality, goal, memory list, and memory limit. Changes apply to local behavior and model observations immediately.
- If OpenRouter is connected, describe a world in the **World description** field. The model produces a validated, compact instance plan: story context, objective, one of three biomes, one of three navigation-tested layouts, supplies, weather, and duration. It cannot generate unrestricted geometry.
- Optional real-time voices use the browser's built-in speech synthesis. Enable them in settings, assign an installed voice to each NPC, and choose a speech rate. Voice availability and quality depend on Windows and the browser, and use no model credits.
- Settings provides browser-local save/load and portable JSON export/import. Saves include the instance, simulation, memories, relationships, health, and journal; they do not include keys or voice settings. Imports load paused.
- The default six-minute simulation day runs from 08:00 to 18:00; generated instances can use a validated three-to-twelve-minute duration. Restore the antenna to win; the deadline closes the experiment. Reset to try another approach.

## Optional OpenRouter connection

Open the in-game settings and enter an OpenRouter key in the masked **OpenRouter API key** field. The key is kept in `sessionStorage` for the current browser tab, sent only to the local app backend, and excluded from world saves and exports. Clear it from settings when finished. Because same-origin browser code can access session storage, a server environment variable remains the safer choice for shared or hosted deployments.

Alternatively, supply **OPENROUTER_API_KEY** securely through your cloud environment settings, or copy `.env.example` to an ignored `.env` for local development and fill it there. Never put keys in a `VITE_` variable, commit them, or enter them in chat. Restart the API process after changing server configuration.

Optional non-secret setting: `OPENROUTER_MODEL` (default `openai/gpt-4o-mini`). The browser settings panel also lets you select a model by its OpenRouter ID. Select **OpenRouter** after entering a session key or after the server detects its configured key. Use a model that supports JSON output. Account credits and HTTPS access to `openrouter.ai` are required.

Live mode is **hybrid**, not a model call for every action. At most one character gets a model decision every eight real seconds, rotating across the crew. Routine actions continue through local rules between decisions and when a request fails. The server allows a maximum of 120 requests per hour per process, one concurrent request, and a 20-second provider timeout. It caps model output at 250 tokens. These are request limits, not a dollar-denominated spending cap.

The model receives the situation, a character's personality, goal, health, needs, inventory, current task status, nearby people, recent memories, and observer message. It chooses a validated action (`move`, `repair`, `eat`, `rest`, `talk`, `give`, or `punch`). World code owns navigation, inventory, repair, combat, and action execution. Model output is untrusted: unsupported actions and malformed responses are rejected. A request error is shown in settings and the world continues with local behavior. Pausing, resetting, importing, or intervening invalidates stale in-flight decisions.

This version uses structured world observations rather than visual perception. Speech output uses local browser text-to-speech; NPC hearing is still text input. It keeps bounded event memories rather than a vector database or unrestricted agent tools. It contains no multiplayer or external tool execution.

## Checks

```sh
npm test              # simulation and API tests
npm run build         # TypeScript validation and production bundle
npm run test:browser  # desktop/mobile Playwright playtests and screenshots
```

Browser tests use `/usr/bin/chromium` by default. Set `CHROMIUM_PATH` to another Chromium executable if needed. Screenshots go to ignored `artifacts/`.

## Code map

- `src/engine.ts`: serializable simulation, movement routing, actions, observations, interventions, validated save loading.
- `src/contracts.ts`: shared runtime schemas for observations, model decisions, and generated instance plans.
- `src/World.tsx`: procedural 3D scene, character animation, camera controls, rendering fallback.
- `src/App.tsx`: observer UI, simulation clock, save tools, live-decision scheduling.
- `server/app.ts`: optional OpenRouter adapter for decisions and world planning, validation, timeouts and request budget; serves the production build.
- `tests/`: simulation/API checks and browser playtests.

Art and geometry are generated in code. Fonts are bundled locally. No external models or texture downloads are required. Work in the existing checkout; cloud tasks are already isolated, so no additional Git worktree is needed.
