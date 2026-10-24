import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addWorldObject,
  advance,
  applyChatReply,
  applyDecision,
  blocked,
  createWorld,
  interactAsObserver,
  intervene,
  observe,
  parseSave,
  removeWorldObject,
  route,
} from "../src/engine";

function run(world: ReturnType<typeof createWorld>, seconds: number) {
  for (let index = 0; index < seconds * 10; index++) advance(world, 0.1);
}

test("the default world is an open green meadow with interactive objects", () => {
  const world = createWorld();
  assert.equal(world.instance.title, "Open Meadow");
  assert.equal(world.instance.groundColor, "#78a85b");
  assert.ok(world.objects.length >= 6);
  assert.ok(world.objects.some((object) => object.type === "bench"));
  assert.ok(world.objects.some((object) => object.type === "ball"));
  assert.ok(world.objects.every((object) => object.interaction.length > 0));
  assert.match(world.instance.situation, /open-ended/i);
});

test("characters autonomously talk and interact with the physical world", () => {
  const world = createWorld();
  run(world, 80);
  assert.ok(world.events.some((event) => event.kind === "action"));
  assert.ok(world.objects.some((object) => object.uses > 0));
  assert.ok(world.agents.every((agent) => agent.memories.length > 1));
  assert.ok(world.time >= 79);
});

test("movement routes around solid editable objects", () => {
  const world = createWorld();
  const tree = world.objects.find((object) => object.type === "tree")!;
  assert.equal(blocked(tree.position, world), true);
  const path = route([-11, -4], [-3, -4], world);
  assert.ok(path.length > 1);
  assert.ok(path.every((position) => !blocked(position, world)));
});

test("actions validate dynamic object and character targets", () => {
  const world = createWorld();
  const agent = world.agents[0];
  const ball = world.objects.find((object) => object.type === "ball")!;
  assert.equal(
    applyDecision(world, agent.id, {
      action: "interact",
      target: ball.id,
      message: "Let’s play.",
      intent: "I feel playful.",
    }),
    true,
  );
  assert.equal(
    applyDecision(world, agent.id, {
      action: "rest",
      target: ball.id,
      message: "",
      intent: "Impossible rest target.",
    }),
    false,
  );
  assert.equal(
    applyDecision(world, agent.id, {
      action: "talk",
      target: agent.id,
      message: "Hello me.",
      intent: "Self talk.",
    }),
    false,
  );
});

test("local observer chat updates only the addressed character", () => {
  const world = createWorld();
  intervene(world, "message", "mira", "What is your name?");
  advance(world, 0.1);
  assert.match(world.agents[0].message, /Mira/);
  assert.equal(world.agents[0].chatHistory.length, 2);
  assert.equal(world.agents[0].chatHistory[1].source, "local");
  assert.equal(world.agents[1].chatHistory.length, 0);
  assert.ok(
    world.agents[0].memories.some((memory) => memory.includes("Observer said")),
  );
});

test("a model chat reply becomes individual memory and relationship state", () => {
  const world = createWorld();
  const agent = world.agents[0];
  intervene(world, "message", agent.id, "Do you trust me?");
  applyChatReply(world, agent, {
    reply: "A little more than before. You asked me directly.",
    memory: "The observer asked about trust and I answered honestly.",
    relationshipDelta: 3,
  });
  assert.equal(agent.observerRelationship, 3);
  assert.equal(agent.chatHistory[1].source, "openrouter");
  assert.match(agent.memories.at(-1) || "", /trust/i);
  assert.equal(agent.inbox, undefined);
});

test("punching causes damage, breaks trust, and provokes a response", () => {
  const world = createWorld();
  const [attacker, target] = world.agents;
  attacker.position = [0, 0];
  target.position = [0.5, 0];
  const trust = target.relationships[attacker.id];
  assert.equal(
    applyDecision(world, attacker.id, {
      action: "punch",
      target: target.id,
      message: "Back off.",
      intent: "Starting a fight.",
    }),
    true,
  );
  for (let index = 0; index < 20; index++) advance(world, 0.1, false);
  assert.ok(target.health < 100);
  assert.ok(target.relationships[attacker.id] < trust);
  assert.equal(target.provokedBy, attacker.id);
});

test("observer can add, use, and remove editable objects", () => {
  const world = createWorld();
  const before = world.objects.length;
  const lamp = addWorldObject(world, "lamp");
  assert.equal(world.objects.length, before + 1);
  assert.equal(interactAsObserver(world, lamp.id), true);
  assert.equal(lamp.uses, 1);
  assert.equal(removeWorldObject(world, lamp.id), true);
  assert.equal(world.objects.length, before);
});

test("food sharing transfers inventory and records trust and memory", () => {
  const world = createWorld();
  const [giver, receiver] = world.agents;
  giver.position = [0, 0];
  receiver.position = [0.5, 0];
  giver.food = 1;
  receiver.food = 0;
  assert.equal(
    applyDecision(world, giver.id, {
      action: "give",
      target: receiver.id,
      message: "Here you go.",
      intent: "Help a friend.",
    }),
    true,
  );
  for (let index = 0; index < 30; index++) advance(world, 0.1, false);
  assert.equal(giver.food, 0);
  assert.equal(receiver.food, 1);
  assert.ok(receiver.memories.some((memory) => memory.includes("shared food")));
});

test("observations expose individual context, nearby characters, and objects", () => {
  const world = createWorld();
  world.agents[1].position = [12, 12];
  world.agents[0].memories = Array.from(
    { length: 20 },
    (_, index) => `Memory ${index}`,
  );
  const observation = observe(world, world.agents[0]);
  assert.equal(
    observation.nearby.some((agent) => agent.id === "oren"),
    false,
  );
  assert.equal(observation.memories.length, 12);
  assert.equal(observation.objects.length, world.objects.length);
  assert.equal(observation.role, world.agents[0].role);
});

test("saves round-trip separate memories, chats, and edited world state", () => {
  const world = createWorld();
  intervene(world, "message", "mira", "Remember our conversation");
  advance(world, 0.1);
  const rock = addWorldObject(world, "rock");
  rock.name = "Thinking stone";
  const restored = parseSave(JSON.stringify(world));
  assert.deepEqual(restored, world);
  assert.equal(restored.agents[0].chatHistory.length, 2);
  assert.equal(restored.objects.at(-1)?.name, "Thinking stone");
  assert.throws(() => parseSave("{bad"));
});

test("the meadow remains open-ended during a long simulation", () => {
  const world = createWorld();
  run(world, 900);
  assert.ok(world.time >= 899);
  intervene(world, "food");
  assert.ok(world.supplies > 0);
});
