import { z } from "zod";
export const ids = ["mira", "oren", "sol"] as const;
export const locations = ["antenna", "supplies", "shelter", "commons"] as const;
export const biomes = ["woodland", "desert", "tundra"] as const;
export const layouts = ["outpost", "ridge", "crossroads"] as const;
export const instancePlanSchema = z
  .object({
    title: z.string().min(1).max(50),
    premise: z.string().min(1).max(600),
    situation: z.string().min(1).max(600),
    objective: z.string().min(1).max(160),
    biome: z.enum(biomes),
    layout: z.enum(layouts),
    startingSupplies: z.number().int().min(0).max(20),
    startingStorm: z.boolean(),
    duration: z.number().int().min(180).max(720),
  })
  .strict();
export type InstancePlan = z.infer<typeof instancePlanSchema>;
export const DEFAULT_INSTANCE: InstancePlan = {
  title: "Field Station 01",
  premise:
    "Three strangers share a remote research station with a broken uplink.",
  situation:
    "The antenna is damaged and must be restored before the repair window closes.",
  objective: "Bring the station back online.",
  biome: "woodland",
  layout: "outpost",
  startingSupplies: 8,
  startingStorm: false,
  duration: 360,
};
export const decisionSchema = z
  .object({
    action: z.enum(["move", "repair", "eat", "rest", "talk", "give", "punch"]),
    target: z.enum([...locations, ...ids]),
    message: z.string().max(240).default(""),
    intent: z.string().min(1).max(240),
  })
  .strict()
  .refine(
    (d) =>
      ["talk", "give", "punch"].includes(d.action)
        ? (ids as readonly string[]).includes(d.target)
        : d.action === "repair"
          ? d.target === "antenna"
          : d.action === "eat"
            ? d.target === "supplies"
            : d.action === "rest"
              ? d.target === "shelter"
              : (locations as readonly string[]).includes(d.target),
    "Action and target must match",
  );
export type Decision = z.infer<typeof decisionSchema>;
export const observationSchema = z
  .object({
    name: z.string().max(40),
    personality: z.string().max(500),
    goal: z.string().max(300),
    food: z.number().int().min(0).max(100),
    health: z.number().min(0).max(100),
    hunger: z.number().min(0).max(100),
    energy: z.number().min(0).max(100),
    timeRemaining: z.number().min(0).max(720),
    repair: z.number().min(0).max(100),
    supplies: z.number().int().min(0).max(100),
    storm: z.boolean(),
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
    memories: z.array(z.string().max(400)).max(8),
    situation: z.string().max(600),
    observerMessage: z.string().max(400).optional(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
