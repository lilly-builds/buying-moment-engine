import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { normalizeCompanyResponse, normalizePersonResponse } from "@/src/enrich/pdl-client";
import type {
  PdlClient,
  PdlCompanyResult,
  PdlPersonRequest,
  PdlPersonResult,
  ResearchClient,
  ResearchRequest,
  ResearchResponse,
} from "@/src/enrich/types";
import { createMeter, type CostEventRecord } from "@/src/roi/cost-meter";

/**
 * Test doubles for the two external clients + the cost meter. Recorded fixtures
 * flow through the SAME normalizers production uses (`parseMessagesResponse`,
 * `normalizePersonResponse`) — a double that hand-builds the parsed shape would
 * pass while the real parser was broken.
 */

export interface RecordingMeter {
  meter: ReturnType<typeof createMeter>;
  rows: CostEventRecord[];
}

export function recordingMeter(): RecordingMeter {
  const rows: CostEventRecord[] = [];
  return { meter: createMeter({ record: async (row) => void rows.push(row) }), rows };
}

export class FakeResearchClient implements ResearchClient {
  calls: ResearchRequest[] = [];

  constructor(private readonly behaviour: () => Promise<ResearchResponse>) {}

  static fromFixture(fixture: unknown): FakeResearchClient {
    return new FakeResearchClient(async () => parseMessagesResponse(fixture));
  }

  /** A 200 whose body is NOT valid JSON — the call was billed, the output is junk. */
  static malformed(): FakeResearchClient {
    return new FakeResearchClient(async () => ({
      text: "Here is what I found: { \"firmographics\": { oops",
      usage: {
        inputTokens: 1200,
        outputTokens: 90,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        webSearchRequests: 1,
        webFetchRequests: 0,
      },
      model: "claude-sonnet-5",
    }));
  }

  static throwing(error: Error): FakeResearchClient {
    return new FakeResearchClient(async () => {
      throw error;
    });
  }

  async research(request: ResearchRequest): Promise<ResearchResponse> {
    this.calls.push(request);
    return this.behaviour();
  }
}

export class FakePdlClient implements PdlClient {
  personCalls: PdlPersonRequest[] = [];
  companyCalls: number = 0;

  constructor(
    private readonly person: () => Promise<PdlPersonResult>,
    private readonly company: () => Promise<PdlCompanyResult> = async () =>
      normalizeCompanyResponse({ status: 404 }),
  ) {}

  static fromFixture(fixture: unknown): FakePdlClient {
    return new FakePdlClient(async () => normalizePersonResponse(fixture));
  }

  /** A PDL outage: BOTH endpoints fail, as they would on a 429 or a network drop. */
  static throwing(error: Error): FakePdlClient {
    return new FakePdlClient(
      async () => {
        throw error;
      },
      async () => {
        throw error;
      },
    );
  }

  async enrichPerson(request: PdlPersonRequest): Promise<PdlPersonResult> {
    this.personCalls.push(request);
    return this.person();
  }

  async enrichCompany(): Promise<PdlCompanyResult> {
    this.companyCalls += 1;
    return this.company();
  }
}
