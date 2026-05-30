import { describe, expect, test } from "bun:test";
import { translateRoutes } from "../src/routes/translate";

/**
 * Route-level tests that don't touch the DB or the network. The copyright gate
 * runs before any LLM call, so these assertions hold regardless of whether
 * ANTHROPIC_API_KEY is set in the environment.
 */
const post = (body: unknown) =>
  translateRoutes.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const pdBody = {
  source_title: "Amazing Grace",
  source_lyrics: "Amazing grace how sweet the sound\nThat saved a wretch like me",
  source_language: "en",
  target_language: "no",
};

describe("POST /v1/songs/translate", () => {
  test("422 refused for copyrighted content that isn't the user's upload", async () => {
    const res = await post({ ...pdBody, copyright_status: "copyrighted", source_is_user_upload: false });
    expect(res.status).toBe(422);
    const json = (await res.json()) as { error: string; message: string };
    expect(json.error).toBe("translation_refused");
    expect(json.message.toLowerCase()).toContain("copyrighted");
  });

  test("422 refused for too-thin lyrics (quality gate)", async () => {
    const res = await post({ ...pdBody, source_lyrics: "a\nb", copyright_status: "public_domain" });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe("translation_refused");
  });

  test("400 on schema-invalid input (missing target_language)", async () => {
    const res = await post({ source_title: "x", source_lyrics: "one\ntwo", source_language: "en" });
    expect(res.status).toBe(400);
  });
});
