import express from "express";
import path from "node:path";
import {
  chatReplySchema,
  decisionSchema,
  instancePlanSchema,
  observationSchema,
} from "../src/contracts";
import { z } from "zod";
const requestSchema = z
  .object({
    model: z
      .string()
      .regex(/^[a-zA-Z0-9_.:/-]+$/)
      .max(120)
      .optional(),
    observation: observationSchema,
  })
  .strict();
const worldRequestSchema = z
  .object({
    model: z
      .string()
      .regex(/^[a-zA-Z0-9_.:/-]+$/)
      .max(120)
      .optional(),
    prompt: z.string().trim().min(10).max(1200),
  })
  .strict();
const modelRequestSchema = z
  .object({
    model: z
      .string()
      .regex(/^[a-zA-Z0-9_.:/-]+$/)
      .max(120),
  })
  .strict();

function readBrowserKey(req: express.Request) {
  const key = req.get("x-openrouter-key")?.trim();
  if (!key) return undefined;
  if (key.length > 512 || !/^sk-or-[!-~]+$/.test(key)) return null;
  return key;
}
function parseJsonObject(content: string): unknown {
  const trimmed = content.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) throw Error("missing JSON object");
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

export function createApp(providerFetch: typeof fetch = fetch) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "12kb" }));
  let busy = false;
  let lastRequest = 0;
  let windowStart = Date.now();
  let requests = 0;
  let catalogCache:
    | {
        expires: number;
        models: {
          id: string;
          name: string;
          description: string;
          contextLength: number;
          promptPrice: string;
          completionPrice: string;
          free: boolean;
        }[];
      }
    | undefined;
  let lastConnectionTest = 0;
  app.get("/api/status", (_req, res) =>
    res.json({
      configured: !!process.env.OPENROUTER_API_KEY,
      model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
    }),
  );
  app.get("/api/models", async (req, res) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }
    if (catalogCache && catalogCache.expires > Date.now()) {
      res.json({ models: catalogCache.models, cached: true });
      return;
    }
    try {
      const upstream = await providerFetch(
        "https://openrouter.ai/api/v1/models",
        {
          signal: AbortSignal.timeout(12000),
          headers: { "X-Title": "SIM PROJ1" },
        },
      );
      if (!upstream.ok) {
        res.status(502).json({
          error: `Could not load OpenRouter models (HTTP ${upstream.status}).`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        data?: {
          id?: unknown;
          name?: unknown;
          description?: unknown;
          context_length?: unknown;
          pricing?: { prompt?: unknown; completion?: unknown };
          supported_parameters?: unknown;
          architecture?: {
            input_modalities?: unknown;
            output_modalities?: unknown;
          };
        }[];
      };
      const models = (data.data || [])
        .filter(
          (item) =>
            typeof item.id === "string" &&
            item.id !== "openrouter/free" &&
            item.id.length <= 120 &&
            /^[a-zA-Z0-9_.:/-]+$/.test(item.id) &&
            Array.isArray(item.supported_parameters) &&
            item.supported_parameters.includes("response_format") &&
            (!Array.isArray(item.architecture?.output_modalities) ||
              item.architecture.output_modalities.includes("text")),
        )
        .map((item) => {
          const promptPrice = String(item.pricing?.prompt ?? "0").slice(0, 40);
          const completionPrice = String(item.pricing?.completion ?? "0").slice(
            0,
            40,
          );
          return {
            id: String(item.id).slice(0, 120),
            name: String(item.name || item.id).slice(0, 160),
            description: String(item.description || "").slice(0, 500),
            contextLength:
              typeof item.context_length === "number"
                ? Math.max(0, Math.floor(item.context_length))
                : 0,
            promptPrice,
            completionPrice,
            free: Number(promptPrice) === 0 && Number(completionPrice) === 0,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 800);
      catalogCache = { models, expires: Date.now() + 120000 };
      res.json({ models, cached: false });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "Loading the OpenRouter model catalog timed out."
            : "Could not load the OpenRouter model catalog.",
      });
    }
  });
  app.post("/api/test-connection", async (req, res) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }
    const parsed = modelRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Choose a valid OpenRouter model." });
      return;
    }
    const browserKey = readBrowserKey(req);
    if (browserKey === null) {
      res.status(400).json({ error: "Invalid OpenRouter API key format." });
      return;
    }
    const providerKey = browserKey || process.env.OPENROUTER_API_KEY;
    if (!providerKey) {
      res.status(503).json({ error: "Connect an OpenRouter key first." });
      return;
    }
    const now = Date.now();
    const retryMs = 4000 - (now - lastConnectionTest);
    if (retryMs > 0) {
      const retrySeconds = Math.ceil(retryMs / 1000);
      res.set("Retry-After", String(retrySeconds));
      res.status(429).json({
        error: `Wait ${retrySeconds} seconds before testing again.`,
      });
      return;
    }
    lastConnectionTest = now;
    const started = performance.now();
    try {
      const upstream = await providerFetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${providerKey}`,
            "Content-Type": "application/json",
            "X-Title": "SIM PROJ1 connection test",
          },
          body: JSON.stringify({
            model: parsed.data.model,
            max_tokens: 180,
            temperature: 0,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Return one JSON object and no prose. Use exactly these fields: reply, memory, relationshipDelta.",
              },
              {
                role: "user",
                content:
                  'Reply to "hello" as a character. Example shape: {"reply":"Hello.","memory":"The observer greeted me.","relationshipDelta":1}',
              },
            ],
          }),
        },
      );
      if (!upstream.ok) {
        const status = upstream.status === 429 ? 429 : 502;
        res.status(status).json({
          error:
            upstream.status === 429
              ? "OpenRouter rate-limited this key or model (HTTP 429). Wait for the provider limit to reset."
              : `OpenRouter returned HTTP ${upstream.status} for this model.`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content || "";
      const compatible = chatReplySchema.safeParse(
        parseJsonObject(content),
      ).success;
      if (!compatible) {
        res.status(422).json({
          error:
            "The model connected but did not follow the JSON format required by the simulation.",
        });
        return;
      }
      res.json({
        ok: true,
        model: parsed.data.model,
        latencyMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "The connection test timed out."
            : "The connection test returned an invalid response.",
      });
    }
  });
  app.post("/api/world/generate", async (req, res) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }
    const parsed = worldRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res
        .status(400)
        .json({ error: "Describe the world in 10–1200 characters." });
      return;
    }
    const browserKey = readBrowserKey(req);
    if (browserKey === null) {
      res.status(400).json({ error: "Invalid OpenRouter API key format." });
      return;
    }
    const providerKey = browserKey || process.env.OPENROUTER_API_KEY;
    if (!providerKey) {
      res.status(503).json({ error: "Connect an OpenRouter key first." });
      return;
    }
    const now = Date.now();
    if (now - windowStart > 3600000) {
      requests = 0;
      windowStart = now;
    }
    if (busy || requests >= 120) {
      res
        .status(429)
        .json({ error: "The model request budget is busy or exhausted." });
      return;
    }
    busy = true;
    requests++;
    try {
      const upstream = await providerFetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.timeout(25000),
          headers: {
            Authorization: `Bearer ${providerKey}`,
            "Content-Type": "application/json",
            "X-Title": "SIM PROJ1",
          },
          body: JSON.stringify({
            model:
              parsed.data.model ||
              process.env.OPENROUTER_MODEL ||
              "openai/gpt-4o-mini",
            max_tokens: 500,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "Design one small, performant, editable 3D social simulation world from the user prompt. Return JSON with exactly: title, premise, situation, objective, groundColor, skyColor, startingSupplies, startingStorm, objects. Colors are six-digit hex strings. objects is an array of 3-12 items with exactly id, type, name, position, color, scale, interaction. id is a unique lowercase slug. type is tree|bench|ball|crate|table|lamp|rock|flowers. position is [x,z], x -13..13 and z -12..12. scale is 0.35..3. interaction says what a person can do with it. The world is open-ended rather than organized around a fixed mission. Keep objects spread out and include a bench and crate so characters can rest and eat.",
              },
              { role: "user", content: parsed.data.prompt },
            ],
          }),
        },
      );
      if (!upstream.ok) {
        res.status(502).json({
          error: `OpenRouter returned HTTP ${upstream.status}. Check the model, key, and credits.`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw Error("empty");
      const instance = instancePlanSchema.safeParse(parseJsonObject(content));
      if (!instance.success) throw Error("invalid");
      res.json({ instance: instance.data });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "World generation timed out."
            : "The model did not return a valid world plan.",
      });
    } finally {
      busy = false;
    }
  });
  app.post("/api/chat", async (req, res) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.observation.observerMessage) {
      res
        .status(400)
        .json({ error: "A character observation and message are required." });
      return;
    }
    const browserKey = readBrowserKey(req);
    if (browserKey === null) {
      res.status(400).json({ error: "Invalid OpenRouter API key format." });
      return;
    }
    const providerKey = browserKey || process.env.OPENROUTER_API_KEY;
    if (!providerKey) {
      res.status(503).json({ error: "Connect an OpenRouter key first." });
      return;
    }
    const now = Date.now();
    if (now - windowStart > 3600000) {
      requests = 0;
      windowStart = now;
    }
    if (requests >= 120) {
      res.status(429).json({
        error:
          "The hourly OpenRouter request budget is exhausted. Try again later.",
      });
      return;
    }
    requests++;
    try {
      const upstream = await providerFetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.timeout(25000),
          headers: {
            Authorization: `Bearer ${providerKey}`,
            "Content-Type": "application/json",
            "X-Title": "SIM PROJ1 character chat",
          },
          body: JSON.stringify({
            model:
              parsed.data.model ||
              process.env.OPENROUTER_MODEL ||
              "openai/gpt-4o-mini",
            max_tokens: 320,
            temperature: 0.75,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  "You are the embodied simulated person described in the observation. Reply directly to the observer in your own voice. Use your personality, goal, memories, relationship with the observer, recent conversation, nearby people, and physical objects. Do not claim to be an AI. Do not give a generic acknowledgment: answer questions concretely and react naturally. The reply becomes part of your individual memory and affects later decisions. Return one JSON object with exactly reply, memory, relationshipDelta and no prose. reply is 1-400 characters of dialogue. memory is a concise first-person memory of this exchange. relationshipDelta is an integer -5..5 reflecting how the exchange changed your attitude.",
              },
              {
                role: "user",
                content: JSON.stringify(parsed.data.observation),
              },
            ],
          }),
        },
      );
      if (!upstream.ok) {
        const status = upstream.status === 429 ? 429 : 502;
        res.status(status).json({
          error:
            upstream.status === 429
              ? "OpenRouter rate-limited this model. The message was saved; wait briefly or choose another model."
              : `OpenRouter returned HTTP ${upstream.status} while the character was replying.`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw Error("empty");
      const reply = chatReplySchema.safeParse(parseJsonObject(content));
      if (!reply.success) throw Error("invalid");
      res.json({ reply: reply.data });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "The character reply timed out. The message remains in memory."
            : "The model connected but did not return a valid character reply.",
      });
    }
  });
  app.post("/api/decide", async (req, res) => {
    if (req.get("sec-fetch-site") === "cross-site") {
      res.status(403).json({ error: "Cross-site requests are not allowed." });
      return;
    }
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid observation." });
      return;
    }
    const browserKey = readBrowserKey(req);
    if (browserKey === null) {
      res.status(400).json({ error: "Invalid OpenRouter API key format." });
      return;
    }
    const providerKey = browserKey || process.env.OPENROUTER_API_KEY;
    if (!providerKey) {
      res.status(503).json({
        error:
          "OpenRouter is not configured. Add a session key in settings or set OPENROUTER_API_KEY on the server.",
      });
      return;
    }
    const now = Date.now();
    if (now - windowStart > 3600000) {
      requests = 0;
      windowStart = now;
    }
    if (busy || now - lastRequest < 4000 || requests >= 120) {
      res.status(429).json({
        error:
          "Decision budget reached. Local behavior will continue. Maximum 120 requests per hour.",
      });
      return;
    }
    busy = true;
    lastRequest = now;
    requests++;
    try {
      const upstream = await providerFetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {
          method: "POST",
          signal: AbortSignal.timeout(20000),
          headers: {
            Authorization: `Bearer ${providerKey}`,
            "Content-Type": "application/json",
            "X-Title": "SIM PROJ1",
          },
          body: JSON.stringify({
            model:
              parsed.data.model ||
              process.env.OPENROUTER_MODEL ||
              "openai/gpt-4o-mini",
            max_tokens: 250,
            temperature: 0.65,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content:
                  'You are one embodied simulated person in an editable physical world. Use the supplied situation, personality, goal, memories, relationships, nearby people, and object list. Choose ONE feasible action that expresses this individual. Return a JSON object with exactly action, target, message, intent and no prose. Example: {"action":"interact","target":"red-ball","message":"Let’s see where it rolls.","intent":"I feel playful and want to explore."}. action is move|interact|eat|rest|talk|give|punch. move or interact targets an object id from objects. eat targets an object whose type is crate. rest targets an object whose type is bench. talk, give, or punch targets a nearby character id, never yourself. Give only if carrying food. Punch only with a clear contextual reason. message is short visible dialogue and may be empty. intent is a short public explanation, never private chain-of-thought. Do not invent targets.',
              },
              {
                role: "user",
                content: JSON.stringify(parsed.data.observation),
              },
            ],
          }),
        },
      );
      if (!upstream.ok) {
        res.status(502).json({
          error: `OpenRouter returned HTTP ${upstream.status}. Check the model, key, and account credits. Local behavior will continue.`,
        });
        return;
      }
      const data = (await upstream.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw Error("empty");
      const decision = decisionSchema.safeParse(parseJsonObject(content));
      if (!decision.success) throw Error("invalid");
      if (
        ["talk", "give", "punch"].includes(decision.data.action) &&
        !parsed.data.observation.nearby.some(
          (a) => a.id === decision.data.target,
        )
      )
        throw Error("unobserved target");
      if (decision.data.action === "give" && parsed.data.observation.food < 1)
        throw Error("no food");
      if (
        ["move", "interact", "eat", "rest"].includes(decision.data.action) &&
        !parsed.data.observation.objects.some(
          (object) =>
            object.id === decision.data.target &&
            (decision.data.action !== "eat" || object.type === "crate") &&
            (decision.data.action !== "rest" || object.type === "bench"),
        )
      )
        throw Error("unknown object target");
      res.json({ decision: decision.data });
    } catch (error) {
      res.status(502).json({
        error:
          error instanceof Error && error.name === "TimeoutError"
            ? "Model request timed out. Local behavior will continue."
            : "The model did not return a valid action. Local behavior will continue.",
      });
    } finally {
      busy = false;
    }
  });
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Unknown API route." });
  });
  app.use(express.static(path.resolve("dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.resolve("dist/index.html")),
  );
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: "Invalid request body." });
    },
  );
  return app;
}
