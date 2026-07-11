import type { AdaptClient, AdaptRequest } from "@/src/adapt/client";
import { ADAPT_MODEL } from "@/src/adapt/config";
import { ZERO_USAGE, type ResearchResponse } from "@/src/enrich/types";

/**
 * Test double for the Adapter's Anthropic seam. Recorded/canned text flows
 * through the SAME parse -> map -> validate path production uses, so a passing
 * test proves the real validation, not a hand-built shape.
 */
export class FakeAdaptClient implements AdaptClient {
  calls: AdaptRequest[] = [];

  constructor(private readonly behaviour: () => Promise<ResearchResponse>) {}

  /** A billed 200 whose streamed text is `text` (the model's JSON answer). */
  static fromText(text: string): FakeAdaptClient {
    return new FakeAdaptClient(async () => ({
      text,
      usage: ZERO_USAGE,
      model: ADAPT_MODEL,
    }));
  }

  /** A 200 that streamed nothing — an empty answer. */
  static empty(): FakeAdaptClient {
    return FakeAdaptClient.fromText("");
  }

  /** A 200 whose body is not valid JSON. Billed, but junk. */
  static malformed(): FakeAdaptClient {
    return FakeAdaptClient.fromText('Here is your config: { "business": { oops');
  }

  /** A non-2xx / network failure — the client throws before any text. */
  static throwing(error: Error = new Error("Anthropic request failed: 500")): FakeAdaptClient {
    return new FakeAdaptClient(async () => {
      throw error;
    });
  }

  async complete(request: AdaptRequest): Promise<ResearchResponse> {
    this.calls.push(request);
    return this.behaviour();
  }
}
