import { z } from "zod";
import {
  DEFAULT_INSTANCE,
  decisionSchema,
  ids,
  instancePlanSchema,
  objectTypes,
  worldObjectSchema,
  type ChatReply,
  type Decision,
  type InstancePlan,
  type Observation,
  type WorldObjectPlan,
} from "./contracts";

export type Vec = [number, number];
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export type WorldObject = WorldObjectPlan & { uses: number };
export type ChatMessage = {
  id: number;
  role: "observer" | "npc";
  text: string;
  time: number;
  source?: "openrouter" | "local";
};
export type Agent = {
  id: (typeof ids)[number];
  name: string;
  role: string;
  color: string;
  personality: string;
  goal: string;
  observerRelationship: number;
  position: Vec;
  hunger: number;
  energy: number;
  food: number;
  health: number;
  lastHitAt: number;
  provokedBy?: (typeof ids)[number];
  relationships: Record<string, number>;
  memories: string[];
  memoryLimit: number;
  chatHistory: ChatMessage[];
  decision: Decision | null;
  path: Vec[];
  activity: string;
  intent: string;
  message: string;
  messageUntil: number;
  cooldown: number;
  inbox?: string;
};
export type Event = {
  id: number;
  time: number;
  kind: "world" | "action" | "speech" | "observer" | "system";
  text: string;
};
export type World = {
  version: 2;
  time: number;
  agents: Agent[];
  objects: WorldObject[];
  supplies: number;
  storm: boolean;
  events: Event[];
  sequence: number;
  seed: number;
  instance: InstancePlan;
};

const personalities = [
  [
    "mira",
    "Mira",
    "The maker",
    "#da8660",
    "Practical, curious, and stubborn. You like learning how things work and finishing what you start.",
    "Explore the meadow, get to know the others, and find something meaningful to make or improve.",
  ],
  [
    "oren",
    "Oren",
    "The caretaker",
    "#7ba7be",
    "Patient, observant, and empathetic. You notice when others struggle, but sometimes neglect your own needs.",
    "Help the group feel safe, fed, and able to trust each other.",
  ],
  [
    "sol",
    "Sol",
    "The explorer",
    "#cfb667",
    "Independent, playful, and skeptical. You warm up to people who are honest and follow through.",
    "Discover what the field offers and decide who is worth spending time with.",
  ],
] as const;

export function createWorld(instance: InstancePlan = DEFAULT_INSTANCE): World {
  const plan = structuredClone(instance);
  return {
    version: 2,
    time: 0,
    supplies: plan.startingSupplies,
    storm: plan.startingStorm,
    sequence: 1,
    seed: 917,
    instance: plan,
    objects: plan.objects.map((object) => ({ ...object, uses: 0 })),
    agents: personalities.map((personality, index) => ({
      id: personality[0],
      name: personality[1],
      role: personality[2],
      color: personality[3],
      personality: personality[4],
      goal: personality[5],
      observerRelationship: 0,
      position: [-2 + index * 2, 1] as Vec,
      hunger: 24 + index * 9,
      energy: 85 - index * 9,
      food: 1,
      health: 100,
      lastHitAt: -100,
      relationships: Object.fromEntries(
        ids.filter((id) => id !== personality[0]).map((id) => [id, 20]),
      ),
      memories: [`You arrived in ${plan.title}. ${plan.situation}`],
      memoryLimit: 20,
      chatHistory: [],
      decision: null,
      path: [],
      activity: "Looking around the meadow",
      intent: "Deciding what feels interesting.",
      message: "",
      messageUntil: 0,
      cooldown: index * 2,
    })),
    events: [
      {
        id: 1,
        time: 0,
        kind: "world",
        text: `${plan.title}. ${plan.premise}`,
      },
    ],
  };
}

export function log(world: World, kind: Event["kind"], text: string) {
  world.events.push({ id: ++world.sequence, time: world.time, kind, text });
  if (world.events.length > 120) world.events.shift();
}

export function remember(agent: Agent, text: string) {
  agent.memories.push(text.slice(0, 400));
  agent.memories = agent.memories.slice(-agent.memoryLimit);
}

function addChat(
  world: World,
  agent: Agent,
  role: ChatMessage["role"],
  text: string,
  source?: ChatMessage["source"],
) {
  const entry: ChatMessage = {
    id: ++world.sequence,
    role,
    text: text.slice(0, 400),
    time: world.time,
  };
  if (source) entry.source = source;
  agent.chatHistory.push(entry);
  agent.chatHistory = agent.chatHistory.slice(-50);
}

function objectRadius(object: WorldObject) {
  return object.scale * (object.type === "tree" ? 0.75 : 0.55);
}

function solid(object: WorldObject) {
  return ["tree", "crate", "table", "rock"].includes(object.type);
}

export function blocked(position: Vec, world?: World) {
  if (Math.abs(position[0]) > 13 || Math.abs(position[1]) > 12) return true;
  return !!world?.objects.some(
    (object) =>
      solid(object) &&
      distance(position, object.position) < objectRadius(object) + 0.35,
  );
}

export function route(start: Vec, end: Vec, world?: World): Vec[] {
  if (blocked(end, world)) return [];
  const clear = (from: Vec, to: Vec) => {
    const steps = Math.ceil(distance(from, to) * 5);
    for (let index = 1; index <= steps; index++) {
      if (
        blocked(
          [
            from[0] + ((to[0] - from[0]) * index) / steps,
            from[1] + ((to[1] - from[1]) * index) / steps,
          ],
          world,
        )
      )
        return false;
    }
    return true;
  };
  if (clear(start, end)) return [end];
  const startCell: Vec = [Math.round(start[0]), Math.round(start[1])];
  const endCell: Vec = [Math.round(end[0]), Math.round(end[1])];
  const key = (position: Vec) => position.join(",");
  const queue: Vec[] = [startCell];
  const seen = new Map<string, Vec | null>([[key(startCell), null]]);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const position = queue[cursor];
    if (key(position) === key(endCell)) {
      const path: Vec[] = [end];
      let current: Vec | null = position;
      while (current) {
        path.unshift(current);
        current = seen.get(key(current)) ?? null;
      }
      return clear(start, path[0]) ? path : [];
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next: Vec = [position[0] + dx, position[1] + dz];
      if (!blocked(next, world) && !seen.has(key(next))) {
        seen.set(key(next), position);
        queue.push(next);
      }
    }
  }
  return [];
}

function approach(object: WorldObject, agent: Agent): Vec {
  const dx = agent.position[0] - object.position[0];
  const dz = agent.position[1] - object.position[1];
  const length = Math.hypot(dx, dz) || 1;
  const radius = objectRadius(object) + 0.75;
  return [
    clamp(object.position[0] + (dx / length) * radius, -12.8, 12.8),
    clamp(object.position[1] + (dz / length) * radius, -11.8, 11.8),
  ];
}

export function applyDecision(
  world: World,
  id: string,
  input: unknown,
): boolean {
  const result = decisionSchema.safeParse(input);
  const agent = world.agents.find((candidate) => candidate.id === id);
  if (!result.success || !agent || agent.health <= 0) return false;
  const decision = result.data;
  if (decision.target === id) return false;
  const other = world.agents.find(
    (candidate) => candidate.id === decision.target,
  );
  const object = world.objects.find(
    (candidate) => candidate.id === decision.target,
  );
  if (["talk", "give", "punch"].includes(decision.action) && !other)
    return false;
  if (["move", "interact"].includes(decision.action) && !object) return false;
  if (decision.action === "eat" && (!object || object.type !== "crate"))
    return false;
  if (decision.action === "rest" && (!object || object.type !== "bench"))
    return false;
  if (decision.action === "give" && agent.food <= 0) return false;
  if (decision.action === "punch" && (!other || other.health <= 0))
    return false;
  if (decision.action === "eat" && world.supplies <= 0 && agent.food <= 0)
    return false;
  const target = other?.position ?? (object ? approach(object, agent) : null);
  if (!target) return false;
  const path = route(agent.position, target, world);
  if (!path.length) return false;
  agent.decision = decision;
  agent.path = path;
  agent.intent = decision.intent;
  const targetName = other?.name ?? object?.name ?? decision.target;
  agent.activity =
    distance(agent.position, target) > 0.8
      ? `Walking to ${targetName}`
      : decision.action === "rest"
        ? `Resting at ${targetName}`
        : decision.action === "eat"
          ? `Getting food from ${targetName}`
          : decision.action === "punch"
            ? `Confronting ${targetName}`
            : `Using ${targetName}`;
  return true;
}

function speak(
  world: World,
  agent: Agent,
  message: string,
  target?: Agent | "Observer",
  source?: ChatMessage["source"],
) {
  agent.message = message.slice(0, 240);
  agent.messageUntil =
    world.time + Math.max(5, Math.min(10, message.length / 12));
  log(
    world,
    "speech",
    `${agent.name}${target ? ` → ${typeof target === "string" ? target : target.name}` : ""}: “${agent.message}”`,
  );
  if (target === "Observer")
    addChat(world, agent, "npc", agent.message, source);
}

export function recordNpcReply(
  world: World,
  agent: Agent,
  message: string,
  source: "openrouter" | "local" = "local",
  memory?: string,
  relationshipDelta = 0,
) {
  speak(world, agent, message, "Observer", source);
  remember(agent, memory || `You replied to the observer: ${message}`);
  agent.observerRelationship = clamp(
    agent.observerRelationship + relationshipDelta,
    -100,
    100,
  );
  delete agent.inbox;
}

export function applyChatReply(world: World, agent: Agent, reply: ChatReply) {
  recordNpcReply(
    world,
    agent,
    reply.reply,
    "openrouter",
    reply.memory,
    reply.relationshipDelta,
  );
}

function observerReply(agent: Agent, message: string) {
  if (/what('?s| is) your name|vem är du|vad heter du/i.test(message))
    return `My name is ${agent.name}. ${agent.goal}`;
  if (/punch|hit|attack|slag|slå/i.test(message))
    return "I heard you, but I will decide for myself whether violence makes sense.";
  if (/food|hungry|mat|hungrig/i.test(message))
    return "I am thinking about the food crate and whether anyone else needs something too.";
  if (/rest|tired|vila|trött/i.test(message))
    return "You may be right. I can rest on the bench if I need it.";
  if (/hello|hi|hey|hej/i.test(message))
    return `Hello. I’m ${agent.name}. What would you like to know?`;
  return `I heard you. I’m ${agent.name}, and I’ll remember what you said.`;
}

export function localDecision(world: World, agent: Agent): Decision {
  if (agent.inbox) {
    const message = agent.inbox;
    const namedTarget = world.agents.find(
      (candidate) =>
        candidate.id !== agent.id &&
        new RegExp(`\\b${candidate.name}\\b`, "i").test(message),
    );
    recordNpcReply(world, agent, observerReply(agent, message), "local");
    if (/punch|hit|attack|slag|slå/i.test(message) && namedTarget)
      return {
        action: "punch",
        target: namedTarget.id,
        message: "Stay back.",
        intent: "Considering the observer’s aggressive suggestion.",
      };
    if (/rest|tired|vila|trött/i.test(message))
      return {
        action: "rest",
        target:
          world.objects.find((object) => object.type === "bench")?.id ||
          world.objects[0].id,
        message: "",
        intent: "Taking time to recover after the observer’s suggestion.",
      };
    if (/ball|play|lek/i.test(message)) {
      const ball = world.objects.find((object) => object.type === "ball");
      if (ball)
        return {
          action: "interact",
          target: ball.id,
          message: "Let’s see where it rolls.",
          intent: "Trying the activity the observer mentioned.",
        };
    }
  }
  if (agent.provokedBy) {
    const target = agent.provokedBy;
    delete agent.provokedBy;
    return {
      action: "punch",
      target,
      message: "Don’t hit me again.",
      intent: "Reacting after being attacked.",
    };
  }
  const crate = world.objects.find((object) => object.type === "crate");
  if (agent.hunger > 62 && crate && (agent.food > 0 || world.supplies > 0))
    return {
      action: "eat",
      target: crate.id,
      message: "",
      intent: "Getting something to eat before doing anything else.",
    };
  const bench = world.objects.find((object) => object.type === "bench");
  if (agent.energy < 30 && bench)
    return {
      action: "rest",
      target: bench.id,
      message: "",
      intent: "Resting before exhaustion makes every choice harder.",
    };
  world.seed = (world.seed * 1664525 + 1013904223) >>> 0;
  if (world.seed % 3 === 0) {
    const others = world.agents.filter((other) => other.id !== agent.id);
    const other = others[world.seed % others.length];
    if (agent.id === "oren" && other.hunger > 55 && agent.food > 0)
      return {
        action: "give",
        target: other.id,
        message: "Take my spare portion. You look like you need it.",
        intent: "Looking after someone who seems hungry.",
      };
    return {
      action: "talk",
      target: other.id,
      message:
        agent.id === "sol"
          ? "Have you found anything interesting out here?"
          : "How are you feeling about this place?",
      intent: "Learning more about another person.",
    };
  }
  const choices = world.objects.filter(
    (object) => !["crate", "bench"].includes(object.type),
  );
  const object =
    choices[world.seed % Math.max(choices.length, 1)] || world.objects[0];
  return {
    action: "interact",
    target: object.id,
    message:
      world.seed % 2
        ? "This looks worth a closer look."
        : "I wonder what I can do with this.",
    intent: `${object.interaction} It fits my current mood and goals.`,
  };
}

export function advance(world: World, dt: number, local = true) {
  dt = Math.min(0.25, Math.max(0, dt));
  world.time += dt;
  for (const agent of world.agents) {
    if (agent.health <= 0) {
      agent.decision = null;
      agent.path = [];
      agent.activity = "Knocked out";
      continue;
    }
    agent.hunger = clamp(agent.hunger + dt * 0.12);
    agent.energy = clamp(agent.energy - dt * 0.045);
    agent.cooldown = Math.max(0, agent.cooldown - dt);
    if (!agent.decision) {
      if (local && agent.cooldown <= 0)
        applyDecision(world, agent.id, localDecision(world, agent));
      continue;
    }
    const decision = agent.decision;
    const other = world.agents.find(
      (candidate) => candidate.id === decision.target,
    );
    const object = world.objects.find(
      (candidate) => candidate.id === decision.target,
    );
    if (other && distance(agent.position, other.position) > 1.7)
      agent.path = route(agent.position, other.position, world);
    if (agent.path.length) {
      const next = agent.path[0];
      const remaining = distance(agent.position, next);
      const step = dt * (world.storm ? 1.05 : 1.7);
      if (remaining <= step) {
        agent.position = [...next];
        agent.path.shift();
      } else {
        agent.position[0] += ((next[0] - agent.position[0]) / remaining) * step;
        agent.position[1] += ((next[1] - agent.position[1]) / remaining) * step;
      }
      if (agent.path.length) continue;
    }
    let done = false;
    if (decision.action === "rest" && object) {
      agent.activity = `Resting at ${object.name}`;
      agent.energy = clamp(agent.energy + dt * 2);
      agent.health = clamp(agent.health + dt * 0.18);
      object.uses++;
      if (agent.energy > 88) done = true;
    }
    if (decision.action === "eat" && object) {
      if (agent.food > 0) agent.food--;
      else if (world.supplies > 0) world.supplies--;
      else {
        log(world, "action", `${agent.name} found ${object.name} empty.`);
        done = true;
      }
      if (!done) {
        agent.hunger = clamp(agent.hunger - 55);
        object.uses++;
        log(world, "action", `${agent.name} ate beside ${object.name}.`);
        remember(agent, `You ate food from ${object.name}.`);
        done = true;
      }
    }
    if (decision.action === "interact" && object) {
      object.uses++;
      agent.activity = `Interacting with ${object.name}`;
      remember(agent, `You used ${object.name}: ${object.interaction}`);
      log(world, "action", `${agent.name} interacted with ${object.name}.`);
      if (decision.message) speak(world, agent, decision.message);
      if (object.type === "ball") {
        world.seed = (world.seed * 1664525 + 1013904223) >>> 0;
        object.position = [
          clamp(object.position[0] + ((world.seed % 5) - 2), -12, 12),
          clamp(object.position[1] + (((world.seed >> 3) % 5) - 2), -11, 11),
        ];
      }
      done = true;
    }
    if (decision.action === "move") done = true;
    if (["talk", "give", "punch"].includes(decision.action)) {
      if (other && distance(agent.position, other.position) > 1.8) continue;
      if (other) {
        if (decision.action === "give" && agent.food > 0) {
          agent.food--;
          other.food++;
          other.relationships[agent.id] = clamp(
            (other.relationships[agent.id] ?? 0) + 18,
            -100,
            100,
          );
          remember(other, `${agent.name} shared food with you.`);
          log(world, "action", `${agent.name} gave food to ${other.name}.`);
        } else if (decision.action === "punch") {
          world.seed = (world.seed * 1664525 + 1013904223) >>> 0;
          const damage = 10 + (world.seed % 7);
          other.health = clamp(other.health - damage);
          other.lastHitAt = world.time;
          other.provokedBy = agent.id;
          agent.relationships[other.id] = clamp(
            (agent.relationships[other.id] ?? 0) - 22,
            -100,
            100,
          );
          other.relationships[agent.id] = clamp(
            (other.relationships[agent.id] ?? 0) - 35,
            -100,
            100,
          );
          speak(world, agent, decision.message || "Back off.", other);
          speak(
            world,
            other,
            other.health <= 0
              ? "I can’t keep going…"
              : "Stop! What are you doing?",
            agent,
          );
          remember(agent, `You punched ${other.name} for ${damage} damage.`);
          remember(other, `${agent.name} punched you for ${damage} damage.`);
          log(
            world,
            "action",
            `${agent.name} punched ${other.name} for ${damage} damage.`,
          );
        } else if (decision.message) {
          speak(world, agent, decision.message, other);
          remember(agent, `You told ${other.name}: ${decision.message}`);
          remember(other, `${agent.name} said: ${decision.message}`);
          other.relationships[agent.id] = clamp(
            (other.relationships[agent.id] ?? 0) + 4,
            -100,
            100,
          );
          if (decision.action === "talk" && other.health > 0) {
            const reply =
              other.relationships[agent.id] < 0
                ? "I heard you. Give me some space."
                : "I’m listening. Tell me more.";
            speak(world, other, reply, agent);
            remember(agent, `${other.name} replied: ${reply}`);
            remember(other, `You replied to ${agent.name}: ${reply}`);
          }
        }
      }
      done = true;
    }
    if (done) {
      remember(agent, `You chose to ${decision.action}: ${decision.intent}`);
      agent.decision = null;
      agent.path = [];
      agent.cooldown = 2;
      agent.activity = "Considering the next choice";
    }
  }
}

export function intervene(
  world: World,
  type: "food" | "storm" | "calm" | "message",
  agentId?: string,
  message?: string,
) {
  if (type === "food") {
    world.supplies = Math.min(100, world.supplies + 4);
    log(world, "observer", "Observer added 4 portions to the picnic crate.");
  }
  if (type === "storm") {
    world.storm = true;
    log(world, "observer", "Observer brought in rain and wind.");
  }
  if (type === "calm") {
    world.storm = false;
    log(world, "observer", "Observer cleared the weather.");
  }
  if (type === "message" && message?.trim()) {
    const agent = world.agents.find((candidate) => candidate.id === agentId);
    if (agent) {
      agent.inbox = message.trim().slice(0, 400);
      addChat(world, agent, "observer", agent.inbox);
      remember(agent, `Observer said: ${agent.inbox}`);
      log(world, "observer", `Observer → ${agent.name}: “${agent.inbox}”`);
      agent.decision = null;
      agent.path = [];
      agent.cooldown = 0;
    }
  }
  if (["food", "storm", "calm"].includes(type))
    for (const agent of world.agents)
      remember(
        agent,
        type === "food"
          ? "The observer added food to the picnic crate."
          : type === "storm"
            ? "Rain and wind arrived. Moving outside is harder."
            : "The rain cleared and the meadow became calm.",
      );
}

export function interactAsObserver(world: World, objectId: string) {
  const object = world.objects.find((candidate) => candidate.id === objectId);
  if (!object) return false;
  object.uses++;
  log(
    world,
    "observer",
    `Observer interacted with ${object.name}: ${object.interaction}`,
  );
  for (const agent of world.agents)
    remember(agent, `You saw the observer interact with ${object.name}.`);
  return true;
}

export function addWorldObject(
  world: World,
  type: (typeof objectTypes)[number],
) {
  const number = world.sequence + world.objects.length;
  const id = `${type}-${number}`;
  const defaults: Record<
    (typeof objectTypes)[number],
    [string, string, string]
  > = {
    tree: ["New tree", "#4f7b48", "Stand beneath the tree and inspect it."],
    bench: ["New bench", "#936d48", "Sit down and rest."],
    ball: ["New ball", "#d96858", "Kick or roll the ball."],
    crate: ["New crate", "#b88a55", "Inspect the crate and its contents."],
    table: ["New table", "#896742", "Gather around the table."],
    lamp: ["New lamp", "#d5bd68", "Turn the lamp on or inspect it."],
    rock: ["New rock", "#7c8375", "Climb, sit, or examine the rock."],
    flowers: ["New flowers", "#e6ad4e", "Look at or smell the flowers."],
  };
  const [name, color, interaction] = defaults[type];
  const object: WorldObject = {
    id,
    type,
    name,
    position: [Math.min(10, -8 + (world.objects.length % 6) * 3), 9],
    color,
    scale: 1,
    interaction,
    uses: 0,
  };
  world.objects.push(object);
  world.instance.objects = world.objects.map(
    ({ uses: _uses, ...plan }) => plan,
  );
  log(world, "observer", `Observer added ${name} to the world.`);
  return object;
}

export function removeWorldObject(world: World, objectId: string) {
  if (world.objects.length <= 3) return false;
  const index = world.objects.findIndex((object) => object.id === objectId);
  if (index < 0) return false;
  const [removed] = world.objects.splice(index, 1);
  for (const agent of world.agents) {
    if (agent.decision?.target === objectId) {
      agent.decision = null;
      agent.path = [];
    }
  }
  world.instance.objects = world.objects.map(
    ({ uses: _uses, ...plan }) => plan,
  );
  log(world, "observer", `Observer removed ${removed.name} from the world.`);
  return true;
}

export function observe(world: World, agent: Agent): Observation {
  return {
    name: agent.name,
    role: agent.role,
    personality: agent.personality,
    goal: agent.goal,
    observerRelationship: agent.observerRelationship,
    food: agent.food,
    health: agent.health,
    hunger: agent.hunger,
    energy: agent.energy,
    nearby: world.agents
      .filter(
        (other) =>
          other.id !== agent.id && distance(agent.position, other.position) < 9,
      )
      .map((other) => ({
        id: other.id,
        name: other.name,
        relationship: agent.relationships[other.id] ?? 0,
        health: other.health,
      })),
    objects: world.objects.map((object) => ({
      id: object.id,
      name: object.name,
      type: object.type,
      distance: Math.min(40, distance(agent.position, object.position)),
      interaction: object.interaction,
    })),
    memories: agent.memories.slice(-12),
    conversation: agent.chatHistory
      .slice(-14)
      .map(({ role, text }) => ({ role, text })),
    situation: world.instance.situation,
    observerMessage: agent.inbox,
  };
}

const vec = z.tuple([z.number().min(-13).max(13), z.number().min(-12).max(12)]);
const chatMessageSchema = z.object({
  id: z.number().int().nonnegative(),
  role: z.enum(["observer", "npc"]),
  text: z.string().max(400),
  time: z.number().min(0).max(86400),
  source: z.enum(["openrouter", "local"]).optional(),
});
const agentSchema = z.object({
  id: z.enum(ids),
  name: z.string().min(1).max(40),
  role: z.string().min(1).max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  personality: z.string().max(500),
  goal: z.string().max(300),
  observerRelationship: z.number().min(-100).max(100),
  position: vec,
  hunger: z.number().min(0).max(100),
  energy: z.number().min(0).max(100),
  food: z.number().int().min(0).max(100),
  health: z.number().min(0).max(100),
  lastHitAt: z.number(),
  provokedBy: z.enum(ids).optional(),
  relationships: z.record(z.string(), z.number().min(-100).max(100)),
  memories: z.array(z.string().max(400)).max(30),
  memoryLimit: z.number().int().min(4).max(30),
  chatHistory: z.array(chatMessageSchema).max(50),
  decision: decisionSchema.nullable(),
  path: z.array(vec).max(100),
  activity: z.string().max(200),
  intent: z.string().max(240),
  message: z.string().max(240),
  messageUntil: z.number().nonnegative(),
  cooldown: z.number().nonnegative(),
  inbox: z.string().max(400).optional(),
});
const worldSchema = z.object({
  version: z.literal(2),
  time: z.number().min(0).max(86400),
  supplies: z.number().int().min(0).max(100),
  storm: z.boolean(),
  sequence: z.number().int().nonnegative(),
  seed: z.number().int().nonnegative(),
  instance: instancePlanSchema,
  objects: z
    .array(worldObjectSchema.extend({ uses: z.number().int().nonnegative() }))
    .min(3)
    .max(24),
  agents: z.array(agentSchema).length(3),
  events: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        time: z.number().min(0).max(86400),
        kind: z.enum(["world", "action", "speech", "observer", "system"]),
        text: z.string().max(1000),
      }),
    )
    .max(120),
});

export function parseSave(raw: string): World {
  const world = worldSchema.parse(JSON.parse(raw));
  if (
    new Set(world.agents.map((agent) => agent.id)).size !== 3 ||
    new Set(world.objects.map((object) => object.id)).size !==
      world.objects.length ||
    world.agents.some((agent) =>
      agent.path.some((position) => blocked(position, world)),
    )
  )
    throw Error("Invalid character positions, object IDs, or identities");
  return world;
}

export function clock(time: number) {
  const totalMinutes = 8 * 60 + Math.floor(time / 0.6);
  const hour = Math.floor(totalMinutes / 60) % 24;
  const minute = totalMinutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}
