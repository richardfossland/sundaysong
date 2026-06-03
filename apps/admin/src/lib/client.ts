import { AdminClient } from "./adminClient";

/**
 * The admin dashboard's API client. Like the web app it eats its own dog food,
 * but it talks to the internal `/v1/admin/*` surface and carries the admin JWT.
 *
 * Server components resolve the API over the internal network
 * (`API_INTERNAL_URL`, e.g. http://api:3001 in compose); the token comes from
 * the admin session (`ADMIN_API_TOKEN` server-side). Both fall back to
 * localhost / unauthenticated for plain `next dev` against a local API.
 */
const baseUrl = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export const admin = new AdminClient({ baseUrl, token: process.env.ADMIN_API_TOKEN });
