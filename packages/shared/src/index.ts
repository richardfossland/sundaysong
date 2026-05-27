/**
 * Shared types + schemas for SundaySong. Consumed by:
 *  - apps/api (Hono server)
 *  - apps/web (Next.js public site)
 *  - apps/workers (background sync + embedding workers)
 *  - apps/admin (data-quality tools)
 *  - packages/sdk (the public TypeScript client)
 */

export * from "./types";
export * from "./schemas";
