import { test, expect } from "@playwright/test";
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
  await page.getByLabel("SPEAK TO MIRA").fill("Please rest now");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.getByRole("button", { name: "Resume simulation" }).click();
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
