import { test } from "node:test";
import assert from "node:assert/strict";
import {
  advance,
  applyDecision,
  blocked,
  createWorld,
  intervene,
  observe,
  parseSave,
  route,
} from "../src/engine";
function run(w: ReturnType<typeof createWorld>, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) advance(w, 0.1);
}
test("crew autonomously restores the uplink before nightfall", () => {
  const w = createWorld();
  run(w, 360);
  assert.equal(w.outcome, "success");
  assert.equal(w.repair, 100);
  assert.ok(w.time < 360);
  assert.ok(w.agents.some((a) => a.memories.length > 1));
});
test("storm slows identical repair work, clearing restores conditions", () => {
  const calm = createWorld(),
    storm = createWorld();
  intervene(storm, "storm");
  run(calm, 40);
  run(storm, 40);
  assert.ok(storm.repair < calm.repair);
  intervene(storm, "calm");
  assert.equal(storm.storm, false);
});
test("movement routes around habitats and never crosses walls", () => {
  const path = route([-11, -3], [-2, -3]);
  assert.ok(path.length > 1);
  let prev: [number, number] = [-11, -3];
  for (const next of path) {
    for (let i = 0; i <= 20; i++)
      assert.equal(
        blocked([
          prev[0] + ((next[0] - prev[0]) * i) / 20,
          prev[1] + ((next[1] - prev[1]) * i) / 20,
        ]),
        false,
      );
    prev = next;
  }
  const w = createWorld();
  run(w, 100);
  assert.ok(w.agents.every((a) => !blocked(a.position)));
});
test("rejects malformed actions, self-talk, impossible food and remote commands", () => {
  const w = createWorld();
  assert.equal(
    applyDecision(w, "mira", {
      action: "execute",
      target: "shell",
      intent: "hack",
    }),
    false,
  );
  assert.equal(
    applyDecision(w, "mira", {
      action: "talk",
      target: "mira",
      message: "hi",
      intent: "self",
    }),
    false,
  );
  assert.equal(
    applyDecision(w, "mira", {
      action: "eat",
      target: "antenna",
      intent: "eat",
    }),
    false,
  );
  w.supplies = 0;
  w.agents[0].food = 0;
  assert.equal(
    applyDecision(w, "mira", {
      action: "eat",
      target: "supplies",
      intent: "eat",
    }),
    false,
  );
});
test("intervention messages persist and change a character’s next action", () => {
  const w = createWorld();
  intervene(w, "message", "mira", "Please rest now");
  advance(w, 0.1);
  assert.equal(w.agents[0].decision?.action, "rest");
  assert.ok(w.agents[0].memories.some((m) => m.includes("Please rest now")));
  assert.ok(w.events.some((e) => e.kind === "observer"));
  intervene(w, "food");
  assert.equal(w.supplies, 12);
});
test("food sharing transfers inventory and records trust and memory", () => {
  const w = createWorld();
  const [a, b] = w.agents;
  a.position = [0, 0];
  b.position = [0.5, 0];
  a.food = 1;
  b.food = 0;
  const before = b.relationships[a.id];
  assert.equal(
    applyDecision(w, a.id, {
      action: "give",
      target: b.id,
      message: "Here you go.",
      intent: "Help a friend.",
    }),
    true,
  );
  for (let i = 0; i < 30; i++) advance(w, 0.1, false);
  assert.equal(a.food, 0);
  assert.equal(b.food, 1);
  assert.ok(b.relationships[a.id] > before);
  assert.ok(b.memories.some((m) => m.includes("shared food")));
});
test("saves round-trip state; corrupt saves and duplicate identities are rejected", () => {
  const w = createWorld();
  run(w, 12);
  assert.deepEqual(parseSave(JSON.stringify(w)), w);
  assert.throws(() => parseSave("{bad"));
  const malformed = structuredClone(w);
  malformed.agents[0].id = malformed.agents[1].id;
  assert.throws(() => parseSave(JSON.stringify(malformed)));
  const badPos = structuredClone(w);
  badPos.agents[0].position = [-7, -3];
  assert.throws(() => parseSave(JSON.stringify(badPos)));
});
test("observations expose nearby characters only and bounded memories", () => {
  const w = createWorld();
  w.agents[1].position = [12, 12];
  w.agents[0].memories = Array.from({ length: 20 }, (_, i) => `Memory ${i}`);
  const o = observe(w, w.agents[0]);
  assert.equal(
    o.nearby.some((a) => a.id === "oren"),
    false,
  );
  assert.equal(o.memories.length, 8);
});
test("nightfall ends an unrepaired world and prevents later interventions", () => {
  const w = createWorld();
  w.time = 359.9;
  advance(w, 0.2, false);
  assert.equal(w.outcome, "failed");
  const supplies = w.supplies;
  intervene(w, "food");
  assert.equal(w.supplies, supplies);
});

test("eating consumes exactly one food portion, including when taking a spare", () => {
  for (const stored of [1, 5]) {
    const w = createWorld();
    const a = w.agents[0];
    a.food = 0;
    a.hunger = 80;
    a.position = [-5, 3];
    w.supplies = stored;
    applyDecision(w, a.id, {
      action: "eat",
      target: "supplies",
      message: "",
      intent: "Eat a meal.",
    });
    for (let i = 0; i < 30; i++) advance(w, 0.1, false);
    assert.ok(a.hunger < 30);
    assert.equal(w.supplies + a.food, stored - 1);
  }
});
