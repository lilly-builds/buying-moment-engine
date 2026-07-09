import { describe, expect, it } from "vitest";
import type {
  Recipient,
  SendAdapter,
  SendTouchInput,
} from "@/src/send/adapter";
import {
  advanceCadence,
  DEFAULT_TOUCH_OFFSETS_MS,
  MalformedSequenceError,
  planSchedule,
  selectDueTouch,
  TOUCH_COUNT,
  validateSequence,
  type ApprovedSequence,
  type CadenceState,
} from "@/src/send/cadence";

const recipient: Recipient = {
  contactId: "ct_1",
  email: "qa@sandbox.test",
  classification: "sandbox",
};

function goodSequence(): ApprovedSequence {
  return {
    touches: [
      { touchNumber: 1, body: "Touch one" },
      { touchNumber: 2, body: "Touch two" },
      { touchNumber: 3, body: "Touch three", cta: "Grab 15 minutes Thursday?" },
    ],
  };
}

/** A recording SendAdapter — the network-spy for cadence tests. */
function recordingAdapter() {
  const sent: SendTouchInput[] = [];
  const adapter: SendAdapter = {
    provider: "hubspot",
    sendTouch: async (input) => {
      sent.push(input);
      return {
        provider: "hubspot",
        contactId: input.recipient.contactId,
        touchNumber: input.touchNumber,
        enrolled: true,
      };
    },
  };
  return { adapter, sent };
}

describe("validateSequence", () => {
  it("accepts exactly 3 touches (1..3) with bodies and a final named CTA", () => {
    expect(() => validateSequence(goodSequence())).not.toThrow();
  });

  it("rejects a sequence that is not 3 touches", () => {
    expect(() =>
      validateSequence({ touches: goodSequence().touches.slice(0, 2) }),
    ).toThrow(MalformedSequenceError);
  });

  it("rejects an empty body", () => {
    const seq = goodSequence();
    seq.touches[1].body = "   ";
    expect(() => validateSequence(seq)).toThrow(/empty body/);
  });

  it("rejects a missing named CTA on the final touch", () => {
    const seq = goodSequence();
    seq.touches[2].cta = "";
    expect(() => validateSequence(seq)).toThrow(/named CTA/);
  });

  it("rejects mis-numbered touches", () => {
    const seq: ApprovedSequence = {
      touches: [
        { touchNumber: 1, body: "a" },
        { touchNumber: 2, body: "b" },
        { touchNumber: 4, body: "c", cta: "cta" },
      ],
    };
    expect(() => validateSequence(seq)).toThrow(/1, 2, 3/);
  });
});

describe("planSchedule / selectDueTouch (pure)", () => {
  const start = new Date("2026-07-09T00:00:00Z");

  it("plans 3 touches at the default offsets", () => {
    const s = planSchedule(start);
    expect(s.map((t) => t.touchNumber)).toEqual([1, 2, 3]);
    expect(s[1].scheduledAt.getTime() - start.getTime()).toBe(DEFAULT_TOUCH_OFFSETS_MS[1]);
  });

  it("selects the first unsent touch only once its time has arrived (strict order)", () => {
    const s = planSchedule(start, [0, 1000, 2000]);
    expect(selectDueTouch(s, start, [])).toBe(1);
    // touch 1 not yet sent → touch 2 is never jumped to, even at its time
    expect(selectDueTouch(s, new Date(start.getTime() + 1000), [])).toBe(1);
    // touch 1 sent, but touch 2's time not reached → nothing due yet
    expect(selectDueTouch(s, new Date(start.getTime() + 500), [1])).toBeNull();
    // touch 1 sent and touch 2's time reached → touch 2 is due
    expect(selectDueTouch(s, new Date(start.getTime() + 1000), [1])).toBe(2);
  });
});

describe("advanceCadence — the app owns the 3-touch schedule + reply halt", () => {
  const start = new Date("2026-07-09T00:00:00Z");
  const offsets = [0, 1000, 2000];

  it("sends exactly three touches, in order, each carrying the named CTA", async () => {
    const { adapter, sent } = recordingAdapter();
    const seq = goodSequence();
    let state: CadenceState = { startedAt: start, sentTouchNumbers: [] };
    const times = [start, new Date(start.getTime() + 1000), new Date(start.getTime() + 2000)];

    for (const now of times) {
      const r = await advanceCadence(seq, recipient, state, {
        now: () => now,
        hasReplied: async () => false,
        adapter,
        offsetsMs: offsets,
      });
      expect(r.action.action).toBe("sent");
      state = r.state;
    }

    // A fourth tick finds all three sent → complete, no fourth send.
    const done = await advanceCadence(seq, recipient, state, {
      now: () => new Date(start.getTime() + 9999),
      hasReplied: async () => false,
      adapter,
      offsetsMs: offsets,
    });
    expect(done.action.action).toBe("complete");

    expect(sent).toHaveLength(TOUCH_COUNT);
    expect(sent.map((s) => s.touchNumber)).toEqual([1, 2, 3]);
    expect(sent.map((s) => s.body)).toEqual(["Touch one", "Touch two", "Touch three"]);
    // Every touch carries the sequence's named next-step CTA.
    expect(sent.every((s) => s.cta === "Grab 15 minutes Thursday?")).toBe(true);
  });

  it("HALTS on reply-detection — no touch is sent once the prospect replied", async () => {
    const { adapter, sent } = recordingAdapter();
    const r = await advanceCadence(
      goodSequence(),
      recipient,
      { startedAt: start, sentTouchNumbers: [1] },
      { now: () => new Date(start.getTime() + 1000), hasReplied: async () => true, adapter, offsetsMs: offsets },
    );
    expect(r.action.action).toBe("halted_reply");
    expect(sent).toHaveLength(0);
  });

  it("waits when the next touch is not yet due", async () => {
    const { adapter, sent } = recordingAdapter();
    const r = await advanceCadence(
      goodSequence(),
      recipient,
      { startedAt: start, sentTouchNumbers: [1] },
      { now: () => new Date(start.getTime() + 500), hasReplied: async () => false, adapter, offsetsMs: offsets },
    );
    expect(r.action).toMatchObject({ action: "waiting", nextTouchNumber: 2 });
    expect(sent).toHaveLength(0);
  });

  it("a malformed sequence throws BEFORE any send (zero calls)", async () => {
    const { adapter, sent } = recordingAdapter();
    await expect(
      advanceCadence(
        { touches: goodSequence().touches.slice(0, 2) },
        recipient,
        { startedAt: start, sentTouchNumbers: [] },
        { now: () => start, hasReplied: async () => false, adapter, offsetsMs: offsets },
      ),
    ).rejects.toThrow(MalformedSequenceError);
    expect(sent).toHaveLength(0);
  });
});
