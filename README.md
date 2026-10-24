# SIM PROJ1 — Living Meadow

A playable browser prototype for an editable 3D world inhabited by three simulated people. You are an observer: talk to each person, edit their individual identity and memory, change the physical world while it runs, use objects, alter the weather, and watch relationships or conflict develop.

The default world is an open green grass field. It has a tree, bench, ball, picnic crate, table, and wildflowers. The simulation is open-ended.

## Run

Requires **Node.js 24+** and npm. In PowerShell, from the extracted project folder:

```powershell
npm install
npm run dev
```

Open <http://localhost:5173> and keep PowerShell running. Vite proxies `/api` to the Node server on port **3001**. No API key is needed for local mode.

For a production build served on port 3001:

```powershell
npm run build
npm start
```

## Simulation and editing

- Drag to orbit, scroll to zoom, and right-drag to pan. **R** resets the camera. **Space** pauses or resumes.
- Click a person or open **Characters** to inspect health, needs, intentions, relationships, memories, and conversation.
- **Edit this character** changes that NPC’s name, role, personality/context, personal goal, memory limit, and individual memory list. Changes apply immediately. Each NPC keeps a separate chat history, memories, and relationship with the observer.
- **Edit world** changes the world name, description, shared context, current situation, grass color, and sky color while the simulation runs.
- The world editor can add, remove, select, rename, recolor, resize, reposition, and change the type of physical objects. Object types are tree, bench, ball, crate, table, lamp, rock, and flowers. Each object has editable interaction text that NPCs receive in their observations.
- Click a 3D object to open it in the editor. **Interact now** records the observer’s action and adds it to every character’s perception and memory.
- NPCs can move, use objects, eat, rest, talk, share food, and punch. Objects record how often they have been used. Punches cause damage, reduce trust, enter memory, and can provoke retaliation.
- **Intervene** adds food or changes the weather. Rain slows movement.
- Optional voices use browser speech synthesis and require no model credits.
- Browser saves and exported JSON contain the physical world, individual configurations, memories, chats, relationships, and journal. API keys are excluded.

## AI chat and autonomous decisions

Local mode is a deterministic simulation with simple rule-based dialogue. Local replies are visibly marked **local**.

OpenRouter mode has two separate AI paths:

1. **Direct character chat** calls `/api/chat` immediately, including while paused. The selected model receives only that NPC’s personality, goal, memories, relationship with you, recent chat, nearby people, current situation, and physical objects. A validated response contains dialogue, one concise memory, and a small relationship change. Successful replies are marked **AI**. A provider or rate-limit error is shown inside the chat instead of being disguised as an NPC answer.
2. **Background decisions** rotate through characters at most once every 12 real seconds. The model chooses one validated action. Local behavior fills the time between calls and keeps the world moving if a provider request fails.

Direct chat is kept out of the background decision queue, so a message no longer waits for the next autonomous turn. The model’s reply becomes part of that NPC’s own memory and future decision context.

The server validates all output. A decision can use `move`, `interact`, `eat`, `rest`, `talk`, `give`, or `punch`. World code owns movement, inventory, combat, object state, and execution. Models cannot run code or call external tools.

## Optional OpenRouter connection

Enter an OpenRouter key in the masked settings field. The key stays in `sessionStorage` for the current browser tab, goes only to the local backend, and is excluded from saves and exports. Never commit it or paste it into chat.

You can instead set **OPENROUTER_API_KEY** in an ignored `.env` file or the cloud environment. Optional `OPENROUTER_MODEL` selects the server default.

The settings panel loads OpenRouter’s current model catalog, excludes the unpredictable `openrouter/free` router and non-text output models, and separates free from credit-priced choices. Search works against live model names and IDs. **Test selected model** verifies authentication and the structured character-response format used by this application.

Free models can have strict provider rate limits. A successful connection test proves that the model and key worked for that request; it does not reserve later capacity. If direct chat reports HTTP 429, wait briefly or choose another model. The message remains in the NPC’s memory.

The app allows 120 model requests per hour per server process. Session keys remain browser-session only. Before exposing a funded endpoint publicly, add authentication and per-user budgets.

## AI world creation

The settings prompt can create a new bounded world through the selected model. The validated result contains:

- title, premise, current situation, and objective
- grass and sky colors
- initial food and weather
- 3–24 interactive objects with a supported type, name, position, color, scale, and interaction

Creating a world replaces unsaved progress and pauses the new instance for review. After creation, every field and object remains editable in real time.

## Checks

```sh
npm test
npm run build
npm run test:browser
```

Browser screenshots are written to the ignored `artifacts/` directory.

## Code map

- `src/engine.ts`: serializable open-ended simulation, individual memory, object interactions, movement, combat, interventions, and validated saves.
- `src/contracts.ts`: schemas for worlds, objects, observations, decisions, chat replies, and generated instances.
- `src/World.tsx`: procedural grass field, object geometry, people, speech bubbles, camera, and rendering fallback.
- `src/App.tsx`: observer UI, direct AI chat, NPC editor, live world editor, save tools, and decision scheduling.
- `server/app.ts`: OpenRouter catalog, connection test, direct chat, background decisions, and world generation.
- `tests/`: engine, API, responsive UI, model chat, and browser playtests.

All geometry and art are generated in code. Fonts are bundled locally. No external 3D assets or texture downloads are required.
