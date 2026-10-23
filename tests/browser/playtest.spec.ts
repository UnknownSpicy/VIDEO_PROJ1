import { test, expect } from "@playwright/test";
test.beforeEach(async ({ page }) => {
  await page.route("**/api/models", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        models: [
          {
            id: "recursive/flint-v1.0:free",
            name: "Recursive Flint",
            description: "Free JSON-compatible model",
            contextLength: 262144,
            promptPrice: "0",
            completionPrice: "0",
            free: true,
          },
          {
            id: "openai/gpt-4o-mini",
            name: "OpenAI GPT-4o Mini",
            description: "Credit model",
            contextLength: 128000,
            promptPrice: "0.00000015",
            completionPrice: "0.0000006",
            free: false,
          },
        ],
      }),
    });
  });
});
test("observer can inspect, intervene, converse, save, restore and change speed", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Bring the station back online." }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "artifacts/desktop-world.png" });
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await expect(
    page.getByText("SIMULATION PAUSED", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Characters 03" }).click();
  await page.getByRole("button", { name: /Mira The engineer/ }).click();
  await expect(
    page.getByRole("heading", { name: "Mira", exact: true }),
  ).toBeVisible();
  await page.getByLabel("MESSAGE MIRA").fill("Please rest now");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(
    page.locator(".chat-thread").getByText(/short break, then get back to it/i),
  ).toBeVisible();
  await expect(
    page.locator(".chat-thread").getByText("Please rest now"),
  ).toBeVisible();
  await expect(
    page.getByText("Taking the observer’s advice to rest.", { exact: false }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/character-inspection.png" });
  await page.getByRole("button", { name: "Intervene", exact: true }).click();
  await page.getByRole("button", { name: /Deliver supplies/ }).click();
  await expect(
    page.getByText("Supply drone delivered 4 portions.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Bring in a storm/ }).click();
  await expect(page.getByText("Storm", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Clear the skies/ }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByRole("button", { name: "Save locally" }).click();
  await expect(page.getByRole("button", { name: "Load save" })).toBeEnabled();
  await page.getByRole("button", { name: "Load save" }).click();
  await expect(
    page.getByText("SIMULATION PAUSED", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Speed 4x" }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await page.getByRole("button", { name: "Reset camera" }).click();
  await page.getByRole("button", { name: "Event journal" }).click();
  await expect(page.getByText(/Observer → Mira/)).toBeVisible();
  await page.screenshot({ path: "artifacts/event-journal.png" });
  expect(errors).toEqual([]);
});

test("real-time voices speak visible NPC replies when enabled", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const spoken: string[] = [];
    Object.defineProperty(window, "__spoken", { value: spoken });
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        speak: (utterance: { text: string }) => spoken.push(utterance.text),
      },
    });
    Object.defineProperty(window, "SpeechSynthesisUtterance", {
      configurable: true,
      value: class {
        text: string;
        rate = 1;
        voice = null;
        constructor(text: string) {
          this.text = text;
        }
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByLabel("Speak new dialogue aloud").check();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Characters 03" }).click();
  await page.getByRole("button", { name: /Mira The engineer/ }).click();
  await page.getByLabel("MESSAGE MIRA").fill("Hello Mira");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(
    page
      .locator(".chat-thread")
      .getByText("Hello. I’m Mira. I can hear you clearly."),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __spoken: string[] }).__spoken.join(" "),
      ),
    )
    .toContain("I can hear you clearly");
});

test("AI world prompt creates a validated compact instance", async ({
  page,
}) => {
  await page.route("**/api/world/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instance: {
          title: "Ice Relay",
          premise: "Three researchers hold a remote polar relay.",
          situation: "A whiteout surrounds the damaged radio mast.",
          objective: "Restore the polar relay.",
          biome: "tundra",
          layout: "ridge",
          startingSupplies: 5,
          startingStorm: true,
          duration: 300,
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page
    .getByLabel("OpenRouter API key")
    .fill(["sk-or-v1", "browser-test-key-1234567890"].join("-"));
  await page
    .getByLabel("World description")
    .fill("Create a small polar communications outpost in a whiteout.");
  await page.getByRole("button", { name: "Create new instance" }).click();
  await expect(
    page.getByText("Ice Relay created and paused for review."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Restore the polar relay." }),
  ).toBeVisible();
  await expect(page.getByText(/TUNDRA · RIDGE/)).toBeVisible();
});
test("mobile keeps tools usable and rejects invalid imports without losing the world", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "artifacts/mobile-world.png" });
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from('{"version":1}'),
  });
  await expect(
    page.getByText(
      "Invalid or incompatible save. Your current world is unchanged.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Behind the world." }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/mobile-settings.png" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("restored end-of-day experiment can finish and expose its journal", async ({
  page,
}) => {
  const { createWorld } = await import("../../src/engine");
  const world = createWorld();
  world.repair = 99.95;
  world.agents[0].position = [0, -7];
  world.agents[0].decision = {
    action: "repair",
    target: "antenna",
    message: "",
    intent: "Finish the last connection.",
  };
  await page.goto("/");
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.locator("input[type=file]").setInputFiles({
    name: "almost-finished.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(world)),
  });
  await expect(
    page.getByText("SIMULATION PAUSED", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
  await expect(
    page.getByRole("dialog", { name: "Experiment result" }),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/success.png" });
  await page.getByRole("button", { name: "Read the journal" }).click();
  await expect(
    page.getByRole("dialog", { name: "Experiment result" }),
  ).not.toBeVisible();
  await expect(
    page.getByText("Signal restored.", { exact: false }),
  ).toBeVisible();
});

test("observer can orbit the camera while paused and reset its view", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.waitForTimeout(1500);
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(650, 420);
  await page.mouse.down();
  await page.mouse.move(850, 460, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  const orbited = await canvas.screenshot();
  expect(before.equals(orbited)).toBe(false);
  await page.getByRole("button", { name: "Reset camera" }).click();
  await page.waitForTimeout(800);
  const reset = await canvas.screenshot();
  expect(reset.equals(orbited)).toBe(false);
  await page.screenshot({ path: "artifacts/camera-reset.png" });
  await expect(
    page.getByText("SIMULATION PAUSED", { exact: true }),
  ).toBeVisible();
});

test("model catalog supports live search, selection, testing and saved choice", async ({
  page,
}) => {
  await page.route("**/api/test-connection", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        model: "recursive/flint-v1.0:free",
        latencyMs: 321,
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page
    .getByLabel("OpenRouter API key")
    .fill(["sk-or-v1", "browser-test-key-1234567890"].join("-"));
  await page.getByRole("searchbox", { name: "Free models" }).fill("flint");
  await page
    .getByLabel("Available free models")
    .selectOption("recursive/flint-v1.0:free");
  await expect(page.getByLabel("Selected model ID")).toHaveValue(
    "recursive/flint-v1.0:free",
  );
  await page.getByRole("button", { name: "Test selected model" }).click();
  await expect(
    page.getByText("Connected in 321 ms. JSON responses are compatible."),
  ).toBeVisible();
  await page.screenshot({ path: "artifacts/model-settings.png" });
  await page.getByRole("button", { name: "Save connection settings" }).click();
  await expect(page.getByText("OpenRouter model setting saved.")).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await expect(page.getByLabel("Selected model ID")).toHaveValue(
    "recursive/flint-v1.0:free",
  );
});

test("OpenRouter key can be entered, hidden, retained for the tab, and cleared", async ({
  page,
}) => {
  const testKey = ["sk-or-v1", "browser-test-key-1234567890"].join("-");
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();

  const keyField = page.getByLabel("OpenRouter API key");
  const openRouterMode = page.getByRole("button", {
    name: "OpenRouter",
    exact: true,
  });
  await expect(keyField).toHaveAttribute("type", "password");
  await expect(openRouterMode).toBeDisabled();

  await keyField.fill(testKey);
  await expect(openRouterMode).toBeEnabled();
  await expect(
    page.getByText("Stored only for this browser tab session"),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show API key" }).click();
  await expect(keyField).toHaveAttribute("type", "text");
  await openRouterMode.click();
  await expect(openRouterMode).toHaveClass(/active/);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("sim-proj1-openrouter-key"),
    ),
  ).toBe(testKey);

  await page.reload();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue(testKey);
  await page.getByRole("button", { name: "Clear API key" }).click();
  await expect(page.getByLabel("OpenRouter API key")).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "OpenRouter", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("sim-proj1-openrouter-key"),
    ),
  ).toBeNull();
});
