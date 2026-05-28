import { SundaySong } from "@sunday/song-sdk";

/**
 * Shared SDK instance — the web app eats its own dog food, calling the public
 * API through the same client third parties use. Base URL is overridable so the
 * site can point at a local API in dev and the real one in prod.
 */
const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const api = new SundaySong({ baseUrl });
