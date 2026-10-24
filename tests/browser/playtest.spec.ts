import { test, expect } from "@playwright/test";

const testKey = ["sk-or-v1", "browser-test-key-1234567890"].join("-");

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

test("the observer can edit the meadow, objects, and one character", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Observe the people and shape the living world.",
    }),
  ).toBeVisible();
  await expect(page.locator("canvas")).toBeVisible();
  await page.getByRole("button", { name: "Pause simulation" }).click();

  await page.getByRole("button", { name: /Edit world/ }).click();
  await expect(
    page.getByRole("heading", { name: "Edit the living world." }),
  ).toBeVisible();
  await page.getByLabel("Name").first().fill("My Live Meadow");
  await expect(page.getByText("My Live Meadow", { exact: true })).toBeVisible();
  await page.getByLabel("New object type").selectOption("lamp");
  await page.getByRole("button", { name: "Add object" }).click();
  await expect(page.getByText(/7 INTERACTIVE OBJECTS/)).toBeVisible();
  await page.getByLabel("Color", { exact: true }).fill("#ffcc44");
  await page.getByRole("button", { name: "Interact now" }).click();
  await expect(page.getByText(/You interacted with New lamp/)).toBeVisible();
  await page.screenshot({ path: "artifacts/world-editor.png" });

  await page.getByRole("button", { name: /Characters/ }).click();
  await page.getByRole("button", { name: /Mira The maker/ }).click();
  await page.getByRole("button", { name: "Edit this character" }).click();
  await page
    .getByLabel("Personal goal")
    .fill("Learn to trust Sol and play with the red ball.");
  await page
    .getByLabel("Individual memories")
    .fill("I like the old oak.\nThe observer was kind to me.");
  await page.getByRole("button", { name: /Save Mira/ }).click();
  await expect(
    page.getByText(/Mira's individual configuration saved/),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("local chat answers immediately and labels the source", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: /Characters/ }).click();
  await page.getByRole("button", { name: /Mira The maker/ }).click();
  await page.getByLabel("MESSAGE MIRA").fill("What is your name?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.locator(".chat-thread").getByText(/My name is Mira/),
  ).toBeVisible();
  await expect(page.locator(".chat-thread").getByText(/local/)).toBeVisible();
});

test("OpenRouter chat uses a dedicated endpoint and updates individual memory", async ({
  page,
}) => {
  let observation: Record<string, unknown> | undefined;
  await page.route("**/api/chat", async (route) => {
    observation = (
      route.request().postDataJSON() as { observation: Record<string, unknown> }
    ).observation;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reply: {
          reply:
            "I’m Mira. I want to understand this meadow and the people in it.",
          memory: "The observer asked who I am, and I explained my purpose.",
          relationshipDelta: 2,
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByLabel("OpenRouter API key").fill(testKey);
  await page.getByRole("button", { name: "OpenRouter", exact: true }).click();
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: /Characters/ }).click();
  await page.getByRole("button", { name: /Mira The maker/ }).click();
  await page.getByLabel("MESSAGE MIRA").fill("Who are you?");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(
    page.locator(".chat-thread").getByText(/I’m Mira/),
  ).toBeVisible();
  await expect(page.locator(".chat-thread").getByText(/AI/)).toBeVisible();
  await page.getByRole("button", { name: "Edit this character" }).click();
  await expect(page.getByLabel("Individual memories")).toContainText("");
  await expect(page.getByLabel("Individual memories")).toHaveValue(
    /explained my purpose/,
  );
  expect(observation?.personality).toBeTruthy();
  expect(Array.isArray(observation?.objects)).toBe(true);
  expect(Array.isArray(observation?.conversation)).toBe(true);
  await page.screenshot({ path: "artifacts/ai-character-chat.png" });
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
  await page.getByRole("button", { name: /Characters/ }).click();
  await page.getByRole("button", { name: /Mira The maker/ }).click();
  await page.getByLabel("MESSAGE MIRA").fill("Hello Mira");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as unknown as { __spoken: string[] }).__spoken.join(" "),
      ),
    )
    .toContain("What would you like to know");
});

test("AI world prompt creates a validated editable instance", async ({
  page,
}) => {
  await page.route("**/api/world/generate", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        instance: {
          title: "Moon Garden",
          premise: "Three people explore a quiet silver garden.",
          situation: "The garden is calm and open-ended.",
          objective: "Explore the garden and build relationships.",
          groundColor: "#68855c",
          skyColor: "#9aa7bf",
          startingSupplies: 5,
          startingStorm: false,
          objects: [
            {
              id: "moon-tree",
              type: "tree",
              name: "Moon tree",
              position: [-5, -3],
              color: "#69806b",
              scale: 1,
              interaction: "Inspect its silver leaves.",
            },
            {
              id: "quiet-bench",
              type: "bench",
              name: "Quiet bench",
              position: [4, 3],
              color: "#8a755e",
              scale: 1,
              interaction: "Sit and rest.",
            },
            {
              id: "supply-crate",
              type: "crate",
              name: "Supply crate",
              position: [-3, 4],
              color: "#a28460",
              scale: 1,
              interaction: "Take food.",
            },
          ],
        },
      }),
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await page.getByLabel("OpenRouter API key").fill(testKey);
  await page
    .getByLabel("World description")
    .fill("Create a moonlit garden with places to sit and explore.");
  await page.getByRole("button", { name: "Create new instance" }).click();
  await expect(
    page.getByText("Moon Garden created and paused for review."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Explore the garden and build relationships.",
    }),
  ).toBeVisible();
  await expect(page.getByText(/3 INTERACTIVE OBJECTS/)).toBeVisible();
});

test("mobile keeps all tools usable and rejects invalid imports", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Edit world/ })).toBeVisible();
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "artifacts/mobile-settings.png" });
});

test("observer can orbit the camera while paused and reset its view", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.waitForTimeout(900);
  const canvas = page.locator("canvas");
  const before = await canvas.screenshot();
  await page.mouse.move(650, 420);
  await page.mouse.down();
  await page.mouse.move(850, 460, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  const orbited = await canvas.screenshot();
  expect(before.equals(orbited)).toBe(false);
  await page.getByRole("button", { name: "Reset camera" }).click();
  await page.waitForTimeout(500);
  expect((await canvas.screenshot()).equals(orbited)).toBe(false);
});

test("model selection can be tested, saved, and restored", async ({ page }) => {
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
  await page.getByLabel("OpenRouter API key").fill(testKey);
  await page.getByRole("searchbox", { name: "Free models" }).fill("flint");
  await page
    .getByLabel("Available free models")
    .selectOption("recursive/flint-v1.0:free");
  await page.getByRole("button", { name: "Test selected model" }).click();
  await expect(
    page.getByText("Connected in 321 ms. JSON responses are compatible."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Save connection settings" }).click();
  await page.reload();
  await page.getByRole("button", { name: "Connection settings" }).click();
  await expect(page.getByLabel("Selected model ID")).toHaveValue(
    "recursive/flint-v1.0:free",
  );
});

test("OpenRouter key stays session-only and can be cleared", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Pause simulation" }).click();
  await page.getByRole("button", { name: "Connection settings" }).click();
  const keyField = page.getByLabel("OpenRouter API key");
  await keyField.fill(testKey);
  await expect(
    page.getByText("Stored only for this browser tab session"),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("sim-proj1-openrouter-key"),
    ),
  ).toBe(testKey);
  await page.getByRole("button", { name: "Clear API key" }).click();
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("sim-proj1-openrouter-key"),
    ),
  ).toBeNull();
});
