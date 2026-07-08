import { describe, expect, it } from "vitest";
import { VOICE_MAX_TOKENS, VOICE_MODEL } from "@/src/brief/config";
import type { VoiceRequest } from "@/src/brief/prompts/voice";
import { buildVoiceRequestBody } from "@/src/brief/voice";
import { getPack } from "@/src/packs";

/**
 * The request body is four decisions, three of them 400s if wrong, and one — `stream` — that
 * decides whether a billed-but-timed-out call lands on the CAC ledger at all (P2-4, R19).
 * None of that is reachable through the faked seam the synthesizer tests use, so it is pinned
 * here directly. No network: `buildVoiceRequestBody` is pure.
 */

const request: VoiceRequest = {
  practice: { id: "p1", name: "Metro Derm", city: "Omaha", state: "NE", vertical: "dermatology" },
  facts: [],
  signals: [],
  contact: null,
  pack: getPack("dermatology"),
  zeroSignal: true,
};

describe("buildVoiceRequestBody", () => {
  const body = buildVoiceRequestBody(request);

  it("streams, so a mid-generation timeout is a priced bodyTimeout, not an unbilled throw (P2-4)", () => {
    // The bug this closes: un-streamed, `AbortSignal.timeout` fires on the fetch promise before
    // the meter runs, and a call Anthropic billed records $0. Streaming makes the abort a
    // mid-body failure the client folds into a priced response.
    expect(body.stream).toBe(true);
  });

  it("sends no sampling params — temperature/top_p/top_k are a 400 on Opus 4.8", () => {
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("top_p");
    expect(body).not.toHaveProperty("top_k");
  });

  it("sets adaptive thinking explicitly, and effort INSIDE output_config", () => {
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.output_config.effort).toBe("high");
    expect(body.output_config.format.type).toBe("json_schema");
    // Top-level effort or a top-level format would each be a 400.
    expect(body).not.toHaveProperty("effort");
  });

  it("carries the Opus model and the 16k ceiling", () => {
    expect(body.model).toBe(VOICE_MODEL);
    expect(body.max_tokens).toBe(VOICE_MAX_TOKENS);
  });
});
