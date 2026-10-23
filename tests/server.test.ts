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
              content: JSON.stringify({
                action: "repair",
                target: "antenna",
                message: "",
                intent: "Get the uplink working.",
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
    assert.equal((await res.json()).decision.action, "repair");
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
