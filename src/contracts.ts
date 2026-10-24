import { z } from "zod";

export const ids = ["mira", "oren", "sol"] as const;
export const objectTypes = [
  "tree",
  "bench",
  "ball",
  "crate",
  "table",
  "lamp",
  "rock",
  "flowers",
] as const;

export const worldObjectSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .min(1)
      .max(40),
    type: z.enum(objectTypes),
    name: z.string().min(1).max(60),
    position: z.tuple([
      z.number().min(-13).max(13),
      z.number().min(-12).max(12),
    ]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    scale: z.number().min(0.35).max(3),
    interaction: z.string().min(1).max(180),
  })
  .strict();

export type WorldObjectPlan = z.infer<typeof worldObjectSchema>;

export const instancePlanSchema = z
  .object({
    title: z.string().min(1).max(50),
    premise: z.string().min(1).max(600),
    situation: z.string().min(1).max(600),
    objective: z.string().min(1).max(160),
    groundColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    skyColor: z.string().regex(/^#[0-9a-f]{6}$/i),
    startingSupplies: z.number().int().min(0).max(20),
    startingStorm: z.boolean(),
    objects: z.array(worldObjectSchema).min(3).max(24),
  })
  .strict()
  .refine(
    (plan) =>
      new Set(plan.objects.map((object) => object.id)).size ===
      plan.objects.length,
    "World object IDs must be unique",
  );

export type InstancePlan = z.infer<typeof instancePlanSchema>;

export const DEFAULT_INSTANCE: InstancePlan = {
  title: "Open Meadow",
  premise:
    "Three people share a wide green field and decide for themselves how to spend the day.",
  situation:
    "It is a calm, open-ended day. The people can explore, talk, play, rest, share food, and react to the observer.",
  objective: "Observe the people and shape the living world.",
  groundColor: "#78a85b",
  skyColor: "#bfd5ae",
  startingSupplies: 8,
  startingStorm: false,
  objects: [
    {
      id: "oak-tree",
      type: "tree",
      name: "Old oak",
      position: [-7, -4],
      color: "#477044",
      scale: 1.25,
      interaction: "Stand in its shade and inspect the bark.",
    },
    {
      id: "park-bench",
      type: "bench",
      name: "Wooden bench",
      position: [5, 4],
      color: "#986f45",
      scale: 1,
      interaction: "Sit down, rest, and watch the meadow.",
    },
    {
      id: "red-ball",
      type: "ball",
      name: "Red ball",
      position: [2, -3],
      color: "#d76555",
      scale: 0.8,
      interaction: "Kick or roll the ball across the grass.",
    },
    {
      id: "food-crate",
      type: "crate",
      name: "Picnic crate",
      position: [-4, 4],
      color: "#b98b55",
      scale: 1,
      interaction: "Take food or inspect the shared supplies.",
    },
    {
      id: "picnic-table",
      type: "table",
      name: "Picnic table",
      position: [7, -5],
      color: "#8a6842",
      scale: 1,
      interaction: "Gather around the table or place something on it.",
    },
    {
      id: "flower-patch",
      type: "flowers",
      name: "Wildflowers",
      position: [-1, 7],
      color: "#e4b04e",
      scale: 1.2,
      interaction: "Look at, smell, or pick a wildflower.",
    },
  ],
};

export const decisionSchema = z
  .object({
    action: z.enum([
      "move",
      "interact",
      "eat",
      "rest",
      "talk",
      "give",
      "punch",
    ]),
    target: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .min(1)
      .max(40),
    message: z.string().max(240).default(""),
    intent: z.string().min(1).max(240),
  })
  .strict();

export type Decision = z.infer<typeof decisionSchema>;

export const observationSchema = z
  .object({
    name: z.string().max(40),
    role: z.string().max(80),
    personality: z.string().max(500),
    goal: z.string().max(300),
    observerRelationship: z.number().min(-100).max(100),
    food: z.number().int().min(0).max(100),
    health: z.number().min(0).max(100),
    hunger: z.number().min(0).max(100),
    energy: z.number().min(0).max(100),
    nearby: z
      .array(
        z.object({
          id: z.enum(ids),
          name: z.string().max(40),
          relationship: z.number().min(-100).max(100),
          health: z.number().min(0).max(100),
        }),
      )
      .max(3),
    objects: z
      .array(
        z.object({
          id: z.string().max(40),
          name: z.string().max(60),
          type: z.enum(objectTypes),
          distance: z.number().min(0).max(40),
          interaction: z.string().max(180),
        }),
      )
      .max(24),
    memories: z.array(z.string().max(400)).max(12),
    conversation: z
      .array(
        z.object({
          role: z.enum(["observer", "npc"]),
          text: z.string().max(400),
        }),
      )
      .max(14),
    situation: z.string().max(600),
    observerMessage: z.string().max(400).optional(),
  })
  .strict();

export type Observation = z.infer<typeof observationSchema>;

export const chatReplySchema = z
  .object({
    reply: z.string().min(1).max(400),
    memory: z.string().min(1).max(400),
    relationshipDelta: z.number().int().min(-5).max(5),
  })
  .strict();

export type ChatReply = z.infer<typeof chatReplySchema>;
