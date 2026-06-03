/**
 * Integration tests for the user-contribution route — POST /v1/songs (Phase 8.1).
 *
 * These verify the ROUTE + cross-route contract OFFLINE — no Postgres, no
 * Meilisearch, no network. We inject an in-memory `SongUploadStore` (the same
 * dependency-injection seam the admin routes use for `AdminStore`) that records
 * each contribution as a `pending` upload, and a matching in-memory `AdminStore`
 * backed by the same records. The flow asserted is the real one a contributor
 * triggers from sundaysong.com:
 *   (a) a valid upload is accepted (201) and opens a moderation envelope,
 *   (b) the licence declaration + required fields are enforced (400 otherwise),
 *   (c) the contribution lands in the admin queue as `status=pending` and is
 *       retrievable via GET /v1/admin/uploads.
 */

import { describe, expect, test } from "bun:test";

import type { UploadRecord } from "@sundaysong/shared";
import {
  createSongsRoutes,
  type SongUploadStore,
  type SongUploadResult,
} from "../src/routes/songs";
import { createAdminRoutes, type AdminStore } from "../src/routes/admin";

// ── In-memory stores sharing one upload ledger ───────────────────────────────

/**
 * A fake that mimics what the Postgres pipeline does on a contribution: create a
 * song + variant and open a `pending` moderation envelope. The `uploads` map is
 * the shared ledger the admin store reads from, so the two routes see the same
 * world the way they would over one database.
 */
function fakeWorld() {
  const uploads = new Map<string, UploadRecord>();

  const uploadStore: SongUploadStore = {
    async upload(input): Promise<SongUploadResult> {
      const songId = "song-" + crypto.randomUUID();
      const uploadId = "upload-" + crypto.randomUUID();
      uploads.set(uploadId, {
        id: uploadId,
        song_id: songId,
        title: input.title,
        language: input.language,
        submitted_by: "anonymous",
        submitted_at: new Date().toISOString(),
        status: "pending",
        copyright_status: input.copyright_status,
        moderator_note: null,
      });
      return { song_id: songId, variant_id: "variant-" + crypto.randomUUID(), action: "added", upload_id: uploadId };
    },
  };

  const adminStore: AdminStore = {
    async listUploads(status) {
      const all = [...uploads.values()];
      return status ? all.filter((u) => u.status === status) : all;
    },
    async getUpload(id) {
      return uploads.get(id) ?? null;
    },
    async saveModeration(id, status, note) {
      const u = uploads.get(id);
      if (u) { u.status = status; u.moderator_note = note ?? null; }
    },
    async listSyncRuns() {
      return [];
    },
    async analytics() {
      return { top_queries: [], coverage_gaps: [], total_searches: 0, catalog_size: 0 };
    },
  };

  return { uploadStore, adminStore };
}

const postUpload = (routes: ReturnType<typeof createSongsRoutes>, body: unknown) =>
  routes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const validBody = (over: Record<string, unknown> = {}) => ({
  title: "Store Gud",
  language: "no",
  copyright_status: "public_domain",
  themes: ["creation", "worship"],
  lyricists: ["Carl Boberg"],
  license_declaration: true,
  ...over,
});

// ── (a) Accepting a contribution ──────────────────────────────────────────────

describe("POST /v1/songs", () => {
  test("accepts a valid upload (201) and returns the moderation envelope id", async () => {
    const { uploadStore } = fakeWorld();
    const res = await postUpload(createSongsRoutes({ uploadStore }), validBody());

    expect(res.status).toBe(201);
    const json = (await res.json()) as { song_id: string; action: string; upload_id?: string };
    expect(json.action).toBe("added");
    expect(json.song_id).toMatch(/^song-/);
    expect(json.upload_id).toMatch(/^upload-/);
  });

  test("400 without the licence declaration", async () => {
    const { uploadStore } = fakeWorld();
    const res = await postUpload(createSongsRoutes({ uploadStore }), validBody({ license_declaration: false }));
    expect(res.status).toBe(400); // zValidator rejects the z.literal(true)
  });

  test("400 when the title is missing", async () => {
    const { uploadStore } = fakeWorld();
    const body = validBody();
    delete (body as Record<string, unknown>).title;
    const res = await postUpload(createSongsRoutes({ uploadStore }), body);
    expect(res.status).toBe(400);
  });

  test("400 on a copyright status outside the enum", async () => {
    const { uploadStore } = fakeWorld();
    const res = await postUpload(createSongsRoutes({ uploadStore }), validBody({ copyright_status: "bogus" }));
    expect(res.status).toBe(400);
  });
});

// ── (b) The contribution lands in the moderation queue ────────────────────────

describe("upload → moderation queue (Phase 8.1 end-to-end)", () => {
  test("a submitted upload is retrievable via the admin API with status=pending", async () => {
    const { uploadStore, adminStore } = fakeWorld();
    const songs = createSongsRoutes({ uploadStore });
    const admin = createAdminRoutes({ store: adminStore });

    // Submit, as the web upload form does.
    const submit = await postUpload(songs, validBody({ title: "Lead Me to the Cross" }));
    expect(submit.status).toBe(201);
    const { upload_id } = (await submit.json()) as { upload_id: string };

    // It shows up in the full queue …
    const all = await admin.request("/uploads");
    const allJson = (await all.json()) as { uploads: UploadRecord[] };
    const found = allJson.uploads.find((u) => u.id === upload_id);
    expect(found).toBeDefined();
    expect(found!.status).toBe("pending");
    expect(found!.title).toBe("Lead Me to the Cross");

    // … and in the `pending` filter the moderator dashboard uses.
    const pending = await admin.request("/uploads?status=pending");
    const pendingJson = (await pending.json()) as { uploads: UploadRecord[] };
    expect(pendingJson.uploads.some((u) => u.id === upload_id)).toBe(true);
  });

  test("a moderator can then approve it through the admin route", async () => {
    const { uploadStore, adminStore } = fakeWorld();
    const songs = createSongsRoutes({ uploadStore });
    const admin = createAdminRoutes({ store: adminStore });

    const submit = await postUpload(songs, validBody());
    const { upload_id } = (await submit.json()) as { upload_id: string };

    const moderate = await admin.request(`/uploads/${upload_id}/moderate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "approve" }),
    });
    expect(moderate.status).toBe(200);
    expect((await moderate.json()) as { status: string }).toEqual({ upload_id, status: "approved" });

    // The shared ledger reflects the new status.
    const after = await adminStore.getUpload(upload_id);
    expect(after!.status).toBe("approved");
  });
});
