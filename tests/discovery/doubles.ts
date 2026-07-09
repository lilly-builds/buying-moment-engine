import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { CLASSIFY_MODEL } from "@/src/discovery/config";
import type { ClassifyClient, ClassifyRequest } from "@/src/discovery/classify";
import type {
  FetchTextSearchFn,
  TextSearchQuery,
} from "@/src/discovery/places-search";
import type {
  FetchPlaceDetailsFn,
  PhoneComplaintsQuery,
} from "@/src/detectors/phone-complaints-google-places";
import type { ResearchResponse } from "@/src/enrich/types";

/** A model verdict for one review, as the qualifier returns it. */
export interface ReviewVerdict {
  qualifies: boolean;
  confidence: number;
  category: string;
}

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

  constructor(
    private readonly behaviour: (request: ClassifyRequest) => Promise<ResearchResponse>,
  ) {}

  static fromFixture(fixture: unknown): FakeClassifyClient {
    return new FakeClassifyClient(async () => parseMessagesResponse(fixture, CLASSIFY_MODEL));
  }

  /** The model's verdict for one review, as a bare structured-output object. */
  static fromVerdict(
    output: ReviewVerdict,
    usage?: { input_tokens: number; output_tokens: number },
  ): FakeClassifyClient {
    return FakeClassifyClient.fromFixture(
      classifyMessagesFixture(JSON.stringify(output), usage),
    );
  }

  /**
   * Verdict keyed on the review's text — the seam for orchestration tests where
   * different reviews must qualify differently. An unmapped review defaults to a
   * non-qualifying verdict (the precision-safe default).
   */
  static byReview(verdicts: Record<string, ReviewVerdict>): FakeClassifyClient {
    return new FakeClassifyClient(async (request) => {
      const verdict = verdicts[request.reviewText] ?? {
        qualifies: false,
        confidence: 0.1,
        category: "none",
      };
      return parseMessagesResponse(
        classifyMessagesFixture(JSON.stringify(verdict)),
        CLASSIFY_MODEL,
      );
    });
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
    return this.behaviour(request);
  }
}

/** A Text Search fetcher backed by per-category fixtures; records the queries it saw. */
export function fakeSearchFetcher(responseByCategory: Record<string, unknown>): {
  fetch: FetchTextSearchFn;
  calls: TextSearchQuery[];
} {
  const calls: TextSearchQuery[] = [];
  return {
    calls,
    fetch: async (query) => {
      calls.push(query);
      return responseByCategory[query.category] ?? { status: "ZERO_RESULTS", results: [] };
    },
  };
}

/** A Place Details fetcher backed by per-place_id fixtures; can throw for chosen ids. */
export function fakeDetailsFetcher(config: {
  responses: Record<string, unknown>;
  throwFor?: string[];
}): { fetch: FetchPlaceDetailsFn; calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fetch: async (query: PhoneComplaintsQuery) => {
      calls.push(query.placeId);
      if (config.throwFor?.includes(query.placeId)) {
        throw new Error(`fake details fetch failed for ${query.placeId}`);
      }
      return config.responses[query.placeId] ?? { status: "NOT_FOUND" };
    },
  };
}
