/**
 * Unit tests for the moderation approval workflow state machine.
 *
 * Pure, offline — no DB, no network, no React. The state machine is the single
 * source of truth for which transitions are legal, so the UI (UploadList) and
 * the API route can never drift. We assert the full transition table, the
 * note-required guard, and the structured (never-throwing) error contract.
 */

import { describe, expect, test } from "bun:test";

import {
  ACTIVE_STATUSES,
  allowedActions,
  applyAction,
  canApply,
  isActionable,
  requiresNote,
} from "../src/lib/moderation";
import type { ModerationAction, UploadStatus } from "../src/lib/moderation";

describe("moderation — legal transitions", () => {
  const cases: Array<[UploadStatus, ModerationAction, UploadStatus]> = [
    ["pending", "approve", "approved"],
    ["pending", "reject", "rejected"],
    ["pending", "request_changes", "changes_requested"],
    ["resubmitted", "approve", "approved"],
    ["resubmitted", "reject", "rejected"],
    ["resubmitted", "request_changes", "changes_requested"],
    ["changes_requested", "resubmit", "resubmitted"],
    ["changes_requested", "approve", "approved"],
    ["changes_requested", "reject", "rejected"],
    ["approved", "reopen", "pending"],
    ["rejected", "reopen", "pending"],
  ];

  for (const [from, action, to] of cases) {
    test(`${from} --${action}--> ${to}`, () => {
      const note = requiresNote(action) ? "a reason" : undefined;
      const result = applyAction(from, action, note);
      expect(result.ok).toBe(true);
      expect(result.status).toBe(to);
      expect(canApply(from, action)).toBe(true);
    });
  }
});

describe("moderation — illegal transitions are rejected, not thrown", () => {
  const illegal: Array<[UploadStatus, ModerationAction]> = [
    ["approved", "approve"], // already approved
    ["approved", "reject"],
    ["rejected", "approve"],
    ["pending", "resubmit"], // can't resubmit before changes requested
    ["pending", "reopen"], // reopen is only for terminal states
    ["resubmitted", "resubmit"],
  ];

  for (const [from, action] of illegal) {
    test(`${from} cannot ${action}`, () => {
      const result = applyAction(from, action, "note just in case");
      expect(result.ok).toBe(false);
      expect(result.status).toBe(from); // unchanged
      expect(result.error).toContain(action);
      expect(canApply(from, action)).toBe(false);
    });
  }
});

describe("moderation — note requirement", () => {
  test("reject requires a non-empty note", () => {
    expect(requiresNote("reject")).toBe(true);
    const blank = applyAction("pending", "reject", "   ");
    expect(blank.ok).toBe(false);
    expect(blank.error).toContain("note");
    expect(applyAction("pending", "reject").ok).toBe(false);
    expect(applyAction("pending", "reject", "duplicate").ok).toBe(true);
  });

  test("request_changes requires a note", () => {
    expect(requiresNote("request_changes")).toBe(true);
    expect(applyAction("pending", "request_changes").ok).toBe(false);
    expect(applyAction("pending", "request_changes", "fix the key").ok).toBe(true);
  });

  test("approve does not require a note", () => {
    expect(requiresNote("approve")).toBe(false);
    expect(applyAction("pending", "approve").ok).toBe(true);
  });
});

describe("moderation — allowedActions reflects the table", () => {
  test("pending offers approve/reject/request_changes only", () => {
    expect(allowedActions("pending").sort()).toEqual(["approve", "reject", "request_changes"]);
  });

  test("changes_requested offers resubmit + direct decisions", () => {
    expect(allowedActions("changes_requested").sort()).toEqual(["approve", "reject", "resubmit"]);
  });

  test("approved offers only reopen", () => {
    expect(allowedActions("approved")).toEqual(["reopen"]);
  });

  test("every allowed action is applicable from that status", () => {
    const statuses: UploadStatus[] = ["pending", "resubmitted", "changes_requested", "approved", "rejected"];
    for (const s of statuses) {
      for (const a of allowedActions(s)) {
        expect(canApply(s, a)).toBe(true);
      }
    }
  });
});

describe("moderation — actionability", () => {
  test("queue statuses are actionable; terminal ones are not", () => {
    expect(isActionable("pending")).toBe(true);
    expect(isActionable("resubmitted")).toBe(true);
    expect(isActionable("changes_requested")).toBe(true);
    expect(isActionable("approved")).toBe(false);
    expect(isActionable("rejected")).toBe(false);
  });

  test("ACTIVE_STATUSES matches isActionable", () => {
    for (const s of ACTIVE_STATUSES) expect(isActionable(s)).toBe(true);
  });
});

describe("moderation — a full lifecycle", () => {
  test("pending → changes_requested → resubmitted → approved", () => {
    let status: UploadStatus = "pending";

    const r1 = applyAction(status, "request_changes", "needs a CCLI number");
    expect(r1.ok).toBe(true);
    status = r1.status;
    expect(status).toBe("changes_requested");

    const r2 = applyAction(status, "resubmit");
    expect(r2.ok).toBe(true);
    status = r2.status;
    expect(status).toBe("resubmitted");

    const r3 = applyAction(status, "approve");
    expect(r3.ok).toBe(true);
    status = r3.status;
    expect(status).toBe("approved");

    // Approved is terminal for normal moderation actions.
    expect(applyAction(status, "approve").ok).toBe(false);
  });
});
