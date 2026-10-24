import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app";
import { createWorld, observe } from "../src/engine";
test("API hides credentials, validates observations and clearly reports missing configuration", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.equal(status.configured, false);
    assert.equal("key" in status, false);
    const invalid = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: { name: "bad" } }),
    });
    assert.equal(invalid.status, 400);
    const w = createWorld();
    const res = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: observe(w, w.agents[0]) }),
    });
    assert.equal(res.status, 503);
    assert.match((await res.json()).error, /not configured/);
    const crossSite = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    });
    assert.equal(crossSite.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
  }
});

test("a browser session key is forwarded to OpenRouter without being exposed by status", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const browserKey = ["sk-or-v1", "browser-test-key-1234567890"].join("-");
  let authorization: string | null = null;
  const provider = async (_input: unknown, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization");
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                action: "interact",
                target: "red-ball",
                message: "Let’s play.",
                intent: "Explore the meadow.",
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const server = createApp(provider as typeof fetch).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const status = await (await fetch(`${base}/api/status`)).json();
    assert.deepEqual(Object.keys(status).sort(), ["configured", "model"]);
    assert.equal(status.configured, false);

    const w = createWorld();
    const response = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenRouter-Key": browserKey,
      },
      body: JSON.stringify({ observation: observe(w, w.agents[0]) }),
    });
    assert.equal(response.status, 200);
    assert.equal(authorization, `Bearer ${browserKey}`);

    const invalid = await fetch(`${base}/api/decide`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenRouter-Key": "not-an-openrouter-key",
      },
      body: JSON.stringify({ observation: observe(w, w.agents[0]) }),
    });
    assert.equal(invalid.status, 400);
    assert.match((await invalid.json()).error, /key format/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("direct character chat returns a validated reply with memory and relationship change", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  let payload: { messages?: { content: string }[] } = {};
  const provider = async (_input: unknown, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                reply: "I’m Mira. I want to understand this place.",
                memory: "The observer asked who I am.",
                relationshipDelta: 2,
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const server = createApp(provider as typeof fetch).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const world = createWorld();
    world.agents[0].inbox = "Who are you?";
    const response = await fetch(`http://127.0.0.1:${address.port}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: observe(world, world.agents[0]) }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.reply.relationshipDelta, 2);
    assert.match(result.reply.reply, /Mira/);
    assert.match(payload.messages?.[0]?.content || "", /individual memory/i);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("provider integration returns a validated decision and rejects malformed model output", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  let payload: Record<string, unknown> | undefined;
  const provider = async (_input: unknown, init?: RequestInit) => {
    payload = JSON.parse(String(init?.body));
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: `Here is the requested action:\n\`\`\`json\n${JSON.stringify(
                {
                  action: "interact",
                  target: "red-ball",
                  message: "Let’s see where it rolls.",
                  intent: "I feel playful.",
                },
              )}\n\`\`\``,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const server = createApp(provider as typeof fetch).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const w = createWorld();
    const res = await fetch(`http://127.0.0.1:${address.port}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "test/model",
        observation: observe(w, w.agents[0]),
      }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).decision.action, "interact");
    assert.equal(payload?.model, "test/model");
    assert.equal(payload?.max_tokens, 250);
    const limited = await fetch(`http://127.0.0.1:${address.port}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: observe(w, w.agents[0]) }),
    });
    assert.equal(limited.status, 429);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
  const bad = createApp(
    (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: '{"action":"run_shell","target":"server"}' },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch,
  ).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => bad.once("listening", resolve));
  const badAddress = bad.address();
  assert.ok(badAddress && typeof badAddress !== "string");
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  try {
    const w = createWorld();
    const res = await fetch(`http://127.0.0.1:${badAddress.port}/api/decide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ observation: observe(w, w.agents[0]) }),
    });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /valid action/);
  } finally {
    bad.closeAllConnections();
    await new Promise<void>((resolve) => bad.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("world generation returns only a validated bounded instance plan", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-only-not-a-real-key";
  let prompt = "";
  const provider = async (_input: unknown, init?: RequestInit) => {
    const payload = JSON.parse(String(init?.body)) as {
      messages: { content: string }[];
    };
    prompt = payload.messages[1].content;
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Ice Garden",
                premise: "Three people explore a quiet frozen garden.",
                situation: "The garden is open-ended and calm.",
                objective: "Explore the garden and build relationships.",
                groundColor: "#aebfba",
                skyColor: "#c4d0d3",
                startingSupplies: 5,
                startingStorm: false,
                objects: [
                  {
                    id: "ice-tree",
                    type: "tree",
                    name: "Ice tree",
                    position: [-5, -3],
                    color: "#78908a",
                    scale: 1,
                    interaction: "Inspect its frozen branches.",
                  },
                  {
                    id: "warm-bench",
                    type: "bench",
                    name: "Warm bench",
                    position: [4, 3],
                    color: "#8b755c",
                    scale: 1,
                    interaction: "Sit and rest.",
                  },
                  {
                    id: "food-crate",
                    type: "crate",
                    name: "Food crate",
                    position: [-3, 4],
                    color: "#ad8558",
                    scale: 1,
                    interaction: "Take food.",
                  },
                ],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const server = createApp(provider as typeof fetch).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/world/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "test/model",
          prompt: "Create a small polar communications outpost.",
        }),
      },
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.instance.groundColor, "#aebfba");
    assert.equal(data.instance.objects.length, 3);
    assert.match(prompt, /polar communications/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});

test("model catalog separates compatible free and credit models and connection test validates JSON", async () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  const browserKey = ["sk-or-v1", "catalog-test-key-1234567890"].join("-");
  let testedModel = "";
  const provider = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.endsWith("/models"))
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "openrouter/free",
              name: "Automatic Free Router",
              description: "Changes models between requests",
              context_length: 32000,
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["response_format"],
            },
            {
              id: "example/free:free",
              name: "Example Free",
              description: "A compatible free model",
              context_length: 32000,
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["response_format"],
            },
            {
              id: "example/paid",
              name: "Example Paid",
              description: "A compatible credit model",
              context_length: 64000,
              pricing: { prompt: "0.000001", completion: "0.000002" },
              supported_parameters: ["response_format"],
            },
            {
              id: "example/incompatible",
              name: "No JSON",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["temperature"],
            },
            {
              id: "example/audio-only",
              name: "Audio only",
              pricing: { prompt: "0", completion: "0" },
              supported_parameters: ["response_format"],
              architecture: { output_modalities: ["audio"] },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    const body = JSON.parse(String(init?.body)) as { model: string };
    testedModel = body.model;
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      `Bearer ${browserKey}`,
    );
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '{"reply":"Hello.","memory":"The observer greeted me.","relationshipDelta":1}',
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  const server = createApp(provider as typeof fetch).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const catalogResponse = await fetch(`${base}/api/models`);
    assert.equal(catalogResponse.status, 200);
    const catalog = await catalogResponse.json();
    assert.equal(catalog.models.length, 2);
    assert.equal(
      catalog.models.find((item: { free: boolean }) => item.free).id,
      "example/free:free",
    );
    assert.equal(
      catalog.models.find((item: { free: boolean }) => !item.free).id,
      "example/paid",
    );

    const testResponse = await fetch(`${base}/api/test-connection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenRouter-Key": browserKey,
      },
      body: JSON.stringify({ model: "example/free:free" }),
    });
    assert.equal(testResponse.status, 200);
    const result = await testResponse.json();
    assert.equal(result.ok, true);
    assert.equal(testedModel, "example/free:free");
    const immediateRetry = await fetch(`${base}/api/test-connection`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenRouter-Key": browserKey,
      },
      body: JSON.stringify({ model: "example/free:free" }),
    });
    assert.equal(immediateRetry.status, 429);
    assert.match((await immediateRetry.json()).error, /seconds/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previous) process.env.OPENROUTER_API_KEY = previous;
    else delete process.env.OPENROUTER_API_KEY;
  }
});
