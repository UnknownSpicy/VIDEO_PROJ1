import { z } from "zod";
import {
  DEFAULT_INSTANCE,
  decisionSchema,
  ids,
  locations,
  type Decision,
  type InstancePlan,
  type Observation,
} from "./contracts";
export type Vec = [number, number];
export const PLACES = {
  antenna: [0, -7],
  supplies: [-5, 3],
  shelter: [6, 4],
  commons: [0, 2],
} satisfies Record<string, Vec>;
export const OBSTACLES = [
  { x: -7, z: -3, w: 5, d: 4 },
  { x: 7, z: -2, w: 4, d: 4 },
];
export const LAYOUTS = {
  outpost: {
    places: PLACES,
    obstacles: OBSTACLES,
  },
  ridge: {
    places: {
      antenna: [-5, -7],
      supplies: [5, 3],
      shelter: [-5, 5],
      commons: [1, 1],
    },
    obstacles: [
      { x: -8, z: 0, w: 4, d: 4 },
      { x: 7, z: -2, w: 5, d: 3 },
    ],
  },
  crossroads: {
    places: {
      antenna: [7, -5],
      supplies: [-6, -4],
      shelter: [6, 5],
      commons: [0, 1],
    },
    obstacles: [
      { x: -7, z: 4, w: 4, d: 4 },
      { x: 0, z: -6, w: 4, d: 3 },
    ],
  },
} satisfies Record<
  InstancePlan["layout"],
  {
    places: Record<(typeof locations)[number], Vec>;
    obstacles: typeof OBSTACLES;
  }
>;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const distance = (a: Vec, b: Vec) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export type Agent = {
  id: (typeof ids)[number];
  name: string;
  role: string;
  color: string;
  personality: string;
  goal: string;
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
  version: 1;
  time: number;
  agents: Agent[];
  supplies: number;
  repair: number;
  storm: boolean;
  outcome: "running" | "success" | "failed";
  events: Event[];
  sequence: number;
  seed: number;
  instance: InstancePlan;
};
const personalities = [
  [
    "mira",
    "Mira",
    "The engineer",
    "#da8660",
    "Practical, curious, and stubborn. You care about finishing what you started.",
    "Restore the antenna. Ask for help when exhausted.",
  ],
  [
    "oren",
    "Oren",
    "The caretaker",
    "#7ba7be",
    "Patient and empathetic. You notice when others struggle, but neglect your own rest.",
    "Keep everyone fed and help the team cooperate.",
  ],
  [
    "sol",
    "Sol",
    "The explorer",
    "#cfb667",
    "Independent, resourceful, and skeptical. You warm up to people who follow through.",
    "Help restore contact, but do not work yourself to exhaustion.",
  ],
] as const;
export function createWorld(instance: InstancePlan = DEFAULT_INSTANCE): World {
  const plan = structuredClone(instance);
  return {
    version: 1,
    time: 0,
    supplies: plan.startingSupplies,
    repair: 0,
    storm: plan.startingStorm,
    outcome: "running",
    sequence: 1,
    seed: 917,
    instance: plan,
    agents: personalities.map((p, i) => ({
      id: p[0],
      name: p[1],
      role: p[2],
      color: p[3],
      personality: p[4],
      goal: p[5],
      position: [-2 + i * 2, 1] as Vec,
      hunger: 24 + i * 9,
      energy: 85 - i * 9,
      food: 1,
      health: 100,
      lastHitAt: -100,
      relationships: Object.fromEntries(
        ids.filter((id) => id !== p[0]).map((id) => [id, 20]),
      ),
      memories: [`You arrived at ${plan.title}. ${plan.situation}`],
      memoryLimit: 20,
      decision: null,
      path: [],
      activity: "Taking in the outpost",
      intent: "Deciding where to begin.",
      message: "",
      messageUntil: 0,
      cooldown: i * 2,
    })),
    events: [
      {
        id: 1,
        time: 0,
        kind: "world",
        text: `${plan.title}. ${plan.premise} Objective: ${plan.objective}`,
      },
    ],
  };
}
export function log(w: World, kind: Event["kind"], text: string) {
  w.events.push({ id: ++w.sequence, time: w.time, kind, text });
  if (w.events.length > 100) w.events.shift();
}
function remember(a: Agent, text: string) {
  a.memories.push(text.slice(0, 400));
  a.memories = a.memories.slice(-a.memoryLimit);
}
function layoutFor(w?: World) {
  return LAYOUTS[w?.instance.layout ?? "outpost"];
}
export function blocked(p: Vec, w?: World) {
  return (
    Math.abs(p[0]) > 13 ||
    Math.abs(p[1]) > 12 ||
    layoutFor(w).obstacles.some(
      (o) =>
        Math.abs(p[0] - o.x) < o.w / 2 + 0.35 &&
        Math.abs(p[1] - o.z) < o.d / 2 + 0.35,
    )
  );
}
export function route(start: Vec, end: Vec, w?: World): Vec[] {
  if (blocked(end, w)) return [];
  const clear = (a: Vec, b: Vec) => {
    const n = Math.ceil(distance(a, b) * 5);
    for (let i = 1; i <= n; i++)
      if (
        blocked(
          [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n],
          w,
        )
      )
        return false;
    return true;
  };
  if (clear(start, end)) return [end];
  const s: Vec = [Math.round(start[0]), Math.round(start[1])],
    e: Vec = [Math.round(end[0]), Math.round(end[1])];
  const key = (p: Vec) => p.join(",");
  const queue: Vec[] = [s],
    seen = new Map<string, Vec | null>([[key(s), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (key(p) === key(e)) {
      const path: Vec[] = [end];
      let c: Vec | null = p;
      while (c) {
        path.unshift(c);
        c = seen.get(key(c)) ?? null;
      }
      if (!clear(start, path[0])) return [];
      return path;
    }
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const n: Vec = [p[0] + dx, p[1] + dz];
      if (!blocked(n, w) && !seen.has(key(n))) {
        seen.set(key(n), p);
        queue.push(n);
      }
    }
  }
  return [];
}
export function applyDecision(w: World, id: string, input: unknown): boolean {
  const result = decisionSchema.safeParse(input);
  const a = w.agents.find((a) => a.id === id);
  if (!result.success || !a || a.health <= 0 || w.outcome !== "running")
    return false;
  const d = result.data;
  if (d.target === id) return false;
  if (d.action === "eat" && w.supplies <= 0 && a.food <= 0) {
    a.cooldown = 3;
    return false;
  }
  if (d.action === "give" && a.food <= 0) return false;
  const other = w.agents.find((a) => a.id === d.target);
  if (d.action === "punch" && (!other || other.health <= 0)) return false;
  const place = layoutFor(w).places[d.target as keyof typeof PLACES];
  if (!other && !place) return false;
  // Separate work positions keep the crew readable when sharing a station.
  const offset = [
    [-0.9, 0.4],
    [0.9, 0.4],
    [0, 1.3],
  ][ids.indexOf(a.id)];
  const target: Vec = other
    ? other.position
    : [place[0] + offset[0], place[1] + offset[1]];
  const path = route(a.position, target, w);
  if (!path.length) return false;
  a.decision = d;
  a.path = path;
  a.intent = d.intent;
  a.activity =
    distance(a.position, target) > 0.8
      ? "Walking to " + (other?.name ?? d.target)
      : d.action === "repair"
        ? "Repairing uplink"
        : d.action === "rest"
          ? "Resting"
          : d.action === "eat"
            ? "Getting a meal"
            : d.action === "punch"
              ? `Confronting ${other?.name}`
              : "Connecting";
  return true;
}
function speak(
  w: World,
  a: Agent,
  message: string,
  target?: Agent | "Observer",
) {
  a.message = message.slice(0, 240);
  a.messageUntil = w.time + Math.max(5, Math.min(10, message.length / 12));
  log(
    w,
    "speech",
    `${a.name}${target ? ` → ${typeof target === "string" ? target : target.name}` : ""}: “${a.message}”`,
  );
}
function observerReply(a: Agent, message: string) {
  if (/punch|hit|attack|slag|slå/i.test(message))
    return "I understand, but violence will have consequences here.";
  if (/food|hungry|mat|hungrig/i.test(message))
    return "I hear you. I’ll check the supplies and keep everyone going.";
  if (/rest|tired|vila|trött/i.test(message))
    return "You’re right. I’ll take a short break, then get back to it.";
  if (/hello|hi|hey|hej/i.test(message))
    return `Hello. I’m ${a.name}. I can hear you clearly.`;
  return "I hear you. I’ll consider that as I decide what to do next.";
}
export function localDecision(w: World, a: Agent): Decision {
  if (a.inbox) {
    const msg = a.inbox;
    a.inbox = undefined;
    const other = w.agents.find((b) => b.id !== a.id)!;
    speak(w, a, observerReply(a, msg), "Observer");
    remember(a, `Observer told you: ${msg}`);
    const namedTarget = w.agents.find(
      (candidate) =>
        candidate.id !== a.id &&
        new RegExp(`\\b${candidate.name}\\b`, "i").test(msg),
    );
    if (/punch|hit|attack|slag|slå/i.test(msg) && namedTarget)
      return {
        action: "punch",
        target: namedTarget.id,
        message: "Stay back.",
        intent: "Acting on the observer’s aggressive instruction.",
      };
    if (/rest|tired/i.test(msg))
      return {
        action: "rest",
        target: "shelter",
        message: "",
        intent: "Taking the observer’s advice to rest.",
      };
    if (/talk|help.*other/i.test(msg))
      return {
        action: "talk",
        target: other.id,
        message: "How are you holding up?",
        intent: "Checking in after the observer’s message.",
      };
  }
  if (a.provokedBy && a.health > 0) {
    const target = a.provokedBy;
    a.provokedBy = undefined;
    return {
      action: "punch",
      target,
      message: "Don’t hit me again.",
      intent: "Retaliating after being attacked.",
    };
  }
  if (a.hunger > 60 && (a.food > 0 || w.supplies > 0))
    return {
      action: "eat",
      target: "supplies",
      message: "",
      intent: "I need food before I can focus on the repair.",
    };
  if (a.energy < 28)
    return {
      action: "rest",
      target: "shelter",
      message: "",
      intent: "I’m running low on energy. A break will help.",
    };
  w.seed = (w.seed * 1664525 + 1013904223) >>> 0;
  if (w.seed % 5 === 0) {
    const others = w.agents.filter((b) => b.id !== a.id);
    const other = others[w.seed % others.length];
    if (a.id === "oren" && other.hunger > 55 && a.food > 0)
      return {
        action: "give",
        target: other.id,
        message: "Take my spare portion. You look like you need it.",
        intent: "Making sure the team has enough to eat.",
      };
    return {
      action: "talk",
      target: other.id,
      message: w.storm
        ? "Stay close. We can get through this storm together."
        : "If we work together, we can get the uplink running before dark.",
      intent: "Building trust with the people I depend on.",
    };
  }
  return {
    action: "repair",
    target: "antenna",
    message: "",
    intent:
      a.id === "mira"
        ? "The uplink is our way home. Let’s fix it."
        : a.id === "sol"
          ? "I want to know what’s beyond this station. First, a working signal."
          : "Helping with the antenna while everyone is doing okay.",
  };
}
export function advance(w: World, dt: number, local = true) {
  if (w.outcome !== "running") return;
  dt = Math.min(0.25, Math.max(0, dt));
  w.time += dt;
  for (const a of w.agents) {
    if (a.health <= 0) {
      a.decision = null;
      a.path = [];
      a.activity = "Knocked out";
      continue;
    }
    a.hunger = clamp(a.hunger + dt * 0.16);
    a.energy = clamp(a.energy - dt * 0.065);
    a.cooldown = Math.max(0, a.cooldown - dt);
    if (!a.decision) {
      if (local && a.cooldown <= 0) applyDecision(w, a.id, localDecision(w, a));
      continue;
    }
    const d = a.decision;
    const other = w.agents.find((b) => b.id === d.target);
    if (
      other &&
      (!a.path.length ||
        distance(a.path[a.path.length - 1], other.position) > 1.5)
    )
      a.path = route(a.position, other.position, w);
    if (a.path.length) {
      const next = a.path[0];
      const dist = distance(a.position, next);
      const step = dt * (w.storm ? 1.05 : 1.7);
      if (dist <= step) {
        a.position = [...next];
        a.path.shift();
      } else {
        a.position[0] += ((next[0] - a.position[0]) / dist) * step;
        a.position[1] += ((next[1] - a.position[1]) / dist) * step;
      }
      if (a.path.length) continue;
    }
    let done = false;
    if (d.action === "repair") {
      a.activity = "Repairing uplink";
      const rate = a.id === "mira" ? 0.48 : 0.31;
      w.repair = clamp(
        w.repair +
          dt * rate * (w.storm ? 0.45 : 1) * (a.hunger > 75 ? 0.45 : 1),
      );
      a.energy = clamp(a.energy - dt * 0.5);
      if (a.energy < 22 || a.hunger > 65) done = true;
    }
    if (d.action === "rest") {
      a.activity = "Resting at the shelter";
      a.energy = clamp(a.energy + dt * 2);
      a.health = clamp(a.health + dt * 0.18);
      if (a.energy > 88) done = true;
    }
    if (d.action === "eat") {
      if (a.food > 0) {
        a.food--;
        a.hunger = clamp(a.hunger - 55);
        log(w, "action", `${a.name} ate a meal and feels better.`);
        remember(a, "You ate a meal at the supply station.");
      } else if (w.supplies > 0) {
        w.supplies--;
        a.hunger = clamp(a.hunger - 55);
        if (w.supplies > 0) {
          w.supplies--;
          a.food = 1;
        }
        log(
          w,
          "action",
          `${a.name} ate${a.food ? " and took a spare portion" : " the last stored portion"}.`,
        );
      } else log(w, "action", `${a.name} found the food storage empty.`);
      done = true;
    }
    if (d.action === "talk" || d.action === "give" || d.action === "punch") {
      if (other && distance(a.position, other.position) > 1.6) continue;
      if (other) {
        if (d.action === "give" && a.food > 0) {
          a.food--;
          other.food++;
          other.relationships[a.id] = clamp(
            (other.relationships[a.id] ?? 0) + 18,
            -100,
          );
          remember(other, `${a.name} shared food with you.`);
          log(w, "action", `${a.name} gave a food portion to ${other.name}.`);
        }
        if (d.action === "punch") {
          w.seed = (w.seed * 1664525 + 1013904223) >>> 0;
          const damage = 10 + (w.seed % 7);
          other.health = clamp(other.health - damage);
          other.lastHitAt = w.time;
          other.provokedBy = a.id;
          a.relationships[other.id] = clamp(
            (a.relationships[other.id] ?? 0) - 22,
            -100,
          );
          other.relationships[a.id] = clamp(
            (other.relationships[a.id] ?? 0) - 35,
            -100,
          );
          speak(w, a, d.message || "Back off.", other);
          const reaction =
            other.health <= 0
              ? "I can’t keep going…"
              : damage >= 15
                ? "That hurt! Don’t touch me again."
                : "Stop! What are you doing?";
          speak(w, other, reaction, a);
          remember(a, `You punched ${other.name} for ${damage} damage.`);
          remember(other, `${a.name} punched you for ${damage} damage.`);
          log(
            w,
            "action",
            `${a.name} punched ${other.name} for ${damage} damage. ${other.name} has ${Math.round(other.health)} health.`,
          );
          if (other.health <= 0) {
            other.decision = null;
            other.path = [];
            other.activity = "Knocked out";
            other.provokedBy = undefined;
          }
        } else if (d.message) {
          speak(w, a, d.message, other);
          remember(other, `${a.name} said: ${d.message}`);
          remember(a, `You told ${other.name}: ${d.message}`);
          other.relationships[a.id] = clamp(
            (other.relationships[a.id] ?? 0) + 4,
            -100,
          );
          if (d.action === "talk" && other.health > 0) {
            const reply =
              other.relationships[a.id] < 0
                ? "I heard you. Give me some space."
                : w.storm
                  ? "I’m listening. Let’s stay close until the storm passes."
                  : "I’m with you. Let’s see this through together.";
            speak(w, other, reply, a);
            remember(a, `${other.name} replied: ${reply}`);
            remember(other, `You replied to ${a.name}: ${reply}`);
          }
        }
      }
      done = true;
    }
    if (d.action === "move") done = true;
    if (done) {
      remember(a, `You chose to ${d.action}: ${d.intent}`);
      a.decision = null;
      a.path = [];
      a.cooldown = 2;
      a.activity = "Considering next move";
    }
  }
  if (w.repair >= 100) {
    w.outcome = "success";
    log(
      w,
      "world",
      "Signal restored. The outpost is connected again. You made it together.",
    );
  } else if (w.time >= w.instance.duration) {
    w.time = w.instance.duration;
    w.outcome = "failed";
    log(
      w,
      "world",
      "Nightfall. The repair window has closed. Reset the experiment to try another approach.",
    );
  }
}
export function intervene(
  w: World,
  type: "food" | "storm" | "calm" | "message",
  agentId?: string,
  message?: string,
) {
  if (w.outcome !== "running") return;
  if (type === "food") {
    w.supplies = Math.min(100, w.supplies + 4);
    log(w, "observer", "Observer delivered 4 food portions to storage.");
  }
  if (type === "storm") {
    w.storm = true;
    log(
      w,
      "observer",
      "Observer introduced a storm. Travel and outdoor repairs are slower.",
    );
  }
  if (type === "calm") {
    w.storm = false;
    log(
      w,
      "observer",
      "Observer cleared the weather. The station is quiet again.",
    );
  }
  if (type === "message" && message?.trim()) {
    const a = w.agents.find((a) => a.id === agentId);
    if (a) {
      a.inbox = message.trim().slice(0, 400);
      remember(a, `Observer said: ${a.inbox}`);
      log(w, "observer", `Observer → ${a.name}: “${a.inbox}”`);
      a.decision = null;
      a.path = [];
      a.cooldown = 0;
    }
  }
  if (type === "food" || type === "storm" || type === "calm")
    for (const a of w.agents)
      remember(
        a,
        type === "food"
          ? "A supply drone delivered food."
          : type === "storm"
            ? "A storm arrived. Work outside is harder."
            : "The storm cleared.",
      );
}
export function observe(w: World, a: Agent): Observation {
  return {
    name: a.name,
    personality: a.personality,
    goal: a.goal,
    food: a.food,
    health: a.health,
    hunger: a.hunger,
    energy: a.energy,
    timeRemaining: Math.max(0, w.instance.duration - w.time),
    repair: w.repair,
    supplies: w.supplies,
    storm: w.storm,
    nearby: w.agents
      .filter((b) => b.id !== a.id && distance(a.position, b.position) < 9)
      .map((b) => ({
        id: b.id,
        name: b.name,
        relationship: a.relationships[b.id] ?? 0,
        health: b.health,
      })),
    memories: a.memories.slice(-8),
    situation: w.instance.situation,
    observerMessage: a.inbox,
  };
}
const vec = z.tuple([z.number().min(-13).max(13), z.number().min(-12).max(12)]);
const agentSchema = z.object({
  id: z.enum(ids),
  name: z.string().max(40),
  role: z.string().max(80),
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  personality: z.string().max(500),
  goal: z.string().max(300),
  position: vec,
  hunger: z.number().min(0).max(100),
  energy: z.number().min(0).max(100),
  food: z.number().int().min(0).max(100),
  health: z.number().min(0).max(100).default(100),
  lastHitAt: z.number().default(-100),
  provokedBy: z.enum(ids).optional(),
  relationships: z.record(z.string(), z.number().min(-100).max(100)),
  memories: z.array(z.string().max(400)).max(30),
  memoryLimit: z.number().int().min(4).max(30).default(20),
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
  version: z.literal(1),
  time: z.number().min(0).max(720),
  supplies: z.number().int().min(0).max(100),
  repair: z.number().min(0).max(100),
  storm: z.boolean(),
  outcome: z.enum(["running", "success", "failed"]),
  sequence: z.number().int().nonnegative(),
  seed: z.number().int().nonnegative(),
  instance: z
    .object({
      title: z.string().min(1).max(50),
      premise: z.string().min(1).max(600),
      situation: z.string().min(1).max(600),
      objective: z.string().min(1).max(160),
      biome: z.enum(["woodland", "desert", "tundra"]),
      layout: z.enum(["outpost", "ridge", "crossroads"]),
      startingSupplies: z.number().int().min(0).max(20),
      startingStorm: z.boolean(),
      duration: z.number().int().min(180).max(720),
    })
    .default(DEFAULT_INSTANCE),
  agents: z.array(agentSchema).length(3),
  events: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        time: z.number().min(0).max(720),
        kind: z.enum(["world", "action", "speech", "observer", "system"]),
        text: z.string().max(1000),
      }),
    )
    .max(100),
});
export function parseSave(raw: string): World {
  const w = worldSchema.parse(JSON.parse(raw));
  if (
    new Set(w.agents.map((a) => a.id)).size !== 3 ||
    w.agents.some(
      (a) =>
        blocked(a.position, w) ||
        a.path.some((position) => blocked(position, w)),
    )
  )
    throw Error("Invalid character positions or identities");
  return w;
}
export function clock(time: number) {
  const hour = 8 + Math.floor(time / 36);
  const min = Math.floor(((time % 36) / 36) * 60);
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}
