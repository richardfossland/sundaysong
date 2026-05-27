import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";

import { RecommendInputSchema } from "@sundaysong/shared";

export const recommendRoutes = new Hono();

// POST /v1/recommend
//   Body: RecommendInput
//   Returns: RecommendOutput
recommendRoutes.post("/", zValidator("json", RecommendInputSchema), async (c) => {
  const input = c.req.valid("json");
  // TODO Phase 4.3 — embed input + retrieve candidates + ask Claude to rank
  return c.json({
    picks: [],
    total_minutes_estimate: 0,
    summary: "stub — recommendation engine lands in Phase 4.3",
    received: input,
  });
});
