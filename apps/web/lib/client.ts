import { SundaySong } from "@sunday/song-sdk";

/**
 * Shared SDK instance — the web app eats its own dog food, calling the public
 * API through the same client third parties use.
 *
 * Server vs browser need different base URLs when the API runs as a separate
 * container/host: server components resolve the API over the internal network
 * (e.g. http://api:3001 in docker-compose), while the browser must use the
 * publicly reachable URL. `API_INTERNAL_URL` covers the server side;
 * `NEXT_PUBLIC_API_URL` is inlined for the browser. Both fall back to localhost
 * for plain `next dev`.
 */
const isServer = typeof window === "undefined";
const baseUrl =
  (isServer ? process.env.API_INTERNAL_URL : undefined) ??
  process.env.NEXT_PUBLIC_API_URL ??
  "http://localhost:3001";

export const api = new SundaySong({ baseUrl });
