import { z } from "zod";
export const ids = ["mira", "oren", "sol"] as const;
export const locations = ["antenna", "supplies", "shelter", "commons"] as const;
export const decisionSchema = z
  .object({
    action: z.enum(["move", "repair", "eat", "rest", "talk", "give"]),
    target: z.enum([...locations, ...ids]),
    message: z.string().max(240).default(""),
    intent: z.string().min(1).max(240),
  })
  .strict()
  .refine(
    (d) =>
      ["talk", "give"].includes(d.action)
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
    hunger: z.number().min(0).max(100),
    energy: z.number().min(0).max(100),
    timeRemaining: z.number().min(0).max(360),
    repair: z.number().min(0).max(100),
    supplies: z.number().int().min(0).max(100),
    storm: z.boolean(),
    nearby: z
      .array(
        z.object({
          id: z.enum(ids),
          name: z.string().max(40),
          relationship: z.number().min(-100).max(100),
        }),
      )
      .max(3),
    memories: z.array(z.string().max(400)).max(8),
    observerMessage: z.string().max(400).optional(),
  })
  .strict();
export type Observation = z.infer<typeof observationSchema>;
