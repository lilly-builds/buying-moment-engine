import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import type { ResearchResponse } from "@/src/enrich/types";
import { VOICE_MODEL } from "@/src/brief/config";
import type { VoiceRequest } from "@/src/brief/prompts/voice";
import type { VoiceBrief } from "@/src/brief/schema";
import type { VoiceClient } from "@/src/brief/voice";

/**
 * Test doubles for the Stage 2 seam.
 *
 * A fixture body flows through the SAME `parseMessagesResponse` production uses. A double
 * that hand-built the parsed shape would pass while the real parser was broken — the exact
 * class of false confidence U5's PDL normalizer shipped once already.
 */

export interface FakeVoiceCall {
  request: VoiceRequest;
  attempt: number;
}

/** Usage numbers that price to a real, non-zero Opus 4.8 cost. */
export const FIXTURE_USAGE = {
  input_tokens: 4_000,
  output_tokens: 900,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
} as const;

/** Wrap a voice JSON payload in a real Messages-API response envelope. */
export function voiceResponseBody(voice: unknown): unknown {
  return {
    model: VOICE_MODEL,
    stop_reason: "end_turn",
    content: [{ type: "text", text: JSON.stringify(voice) }],
    usage: FIXTURE_USAGE,
  };
}

/**
 * A scripted body per attempt, each built FROM the request the synthesizer actually sent.
 *
 * That direction matters. The evidence ids only exist once the database has assigned them,
 * so a fake that returned a hard-coded id could never exercise citation closure — it would
 * always "fail" for the wrong reason. Reading the ids out of the request is what lets a
 * test say "cite a real one" and "cite one that does not exist" and mean it.
 *
 * The last entry repeats, so `always` is just a one-entry script.
 */
export type ScriptedVoice = (request: VoiceRequest) => VoiceBrief | Record<string, unknown>;

export class FakeVoiceClient implements VoiceClient {
  calls: FakeVoiceCall[] = [];
  private attempt = 0;

  constructor(private readonly scripted: ScriptedVoice[]) {}

  static always(voice: ScriptedVoice): FakeVoiceClient {
    return new FakeVoiceClient([voice]);
  }

  /** A different brief per attempt — how the retry loop is driven through, not around. */
  static sequence(voices: ScriptedVoice[]): FakeVoiceClient {
    return new FakeVoiceClient(voices);
  }

  async generate(request: VoiceRequest): Promise<ResearchResponse> {
    this.attempt += 1;
    this.calls.push({ request, attempt: this.attempt });
    const index = Math.min(this.attempt - 1, this.scripted.length - 1);
    return parseMessagesResponse(voiceResponseBody(this.scripted[index](request)), VOICE_MODEL);
  }
}

/**
 * A billed 200 whose body is not valid JSON. The call cost money and the output is junk —
 * the meter must still write its row, and the synthesizer must still fail loudly.
 */
export function malformedVoiceClient(): VoiceClient {
  return {
    async generate(): Promise<ResearchResponse> {
      return parseMessagesResponse(
        {
          model: VOICE_MODEL,
          content: [{ type: "text", text: '{"headline": "oops' }],
          usage: FIXTURE_USAGE,
        },
        VOICE_MODEL,
      );
    },
  };
}
