import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { CLASSIFY_MODEL } from "@/src/discovery/config";
import type { ClassifyClient, ClassifyRequest } from "@/src/discovery/classify";
import type { ResearchResponse } from "@/src/enrich/types";

/**
 * Discovery test doubles. Recorded fixtures flow through the SAME
 * `parseMessagesResponse` production uses — a double that hand-built the parsed
 * shape would pass while the real parser was broken. `recordingMeter` is reused
 * from the enrich doubles (one meter recorder for the whole repo's tests).
 */
export { recordingMeter } from "../enrich/doubles";

/** Build a raw Messages-API body carrying a bare structured-output JSON string. */
export function classifyMessagesFixture(
  outputJson: string,
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 420,
    output_tokens: 20,
  },
): unknown {
  return {
    id: "msg_classify_test",
    type: "message",
    role: "assistant",
    model: CLASSIFY_MODEL,
    stop_reason: "end_turn",
    content: [{ type: "text", text: outputJson }],
    usage,
  };
}

export class FakeClassifyClient implements ClassifyClient {
  calls: ClassifyRequest[] = [];

  constructor(private readonly behaviour: () => Promise<ResearchResponse>) {}

  static fromFixture(fixture: unknown): FakeClassifyClient {
    return new FakeClassifyClient(async () => parseMessagesResponse(fixture, CLASSIFY_MODEL));
  }

  /** The model's verdict for one review, as a bare structured-output object. */
  static fromVerdict(
    output: { qualifies: boolean; confidence: number; category: string },
    usage?: { input_tokens: number; output_tokens: number },
  ): FakeClassifyClient {
    return FakeClassifyClient.fromFixture(
      classifyMessagesFixture(JSON.stringify(output), usage),
    );
  }

  /** A billed 200 whose body is not the JSON the schema promised. */
  static malformed(): FakeClassifyClient {
    return new FakeClassifyClient(async () => ({
      text: '{"qualifies": tru',
      usage: {
        inputTokens: 400,
        outputTokens: 6,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
      },
      model: CLASSIFY_MODEL,
    }));
  }

  static throwing(error: Error): FakeClassifyClient {
    return new FakeClassifyClient(async () => {
      throw error;
    });
  }

  async classify(request: ClassifyRequest): Promise<ResearchResponse> {
    this.calls.push(request);
    return this.behaviour();
  }
}
