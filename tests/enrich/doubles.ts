import { parseMessagesResponse } from "@/src/enrich/anthropic-client";
import { EXTRACT_MODEL } from "@/src/enrich/config";
import {
  normalizeCompanyResponse,
  normalizePersonResponse,
} from "@/src/enrich/pdl-client";
import type { ScrapeFailure } from "@/src/enrich/scrape";
import type { Scraper } from "@/src/enrich/waterfall";
import type {
  ExtractClient,
  ExtractRequest,
  PdlClient,
  PdlCompanyResult,
  PdlPersonDiscoveryRequest,
  PdlPersonDiscoveryResult,
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
  return {
    meter: createMeter({ record: async (row) => void rows.push(row) }),
    rows,
  };
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
      text: 'Here is what I found: { "firmographics": { oops',
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

/**
 * A scraper that never touches the network. `pages` is the substrate the extractor is
 * shown AND the substrate `citations.ts` verifies against — the same map, as in
 * production. Handing the verifier a different map than the model saw would make every
 * test a tautology.
 */
export interface FakeScraper {
  scrape: Scraper;
  calls: string[];
}

export function fakeScraper(pages: Map<string, string>): FakeScraper {
  const calls: string[] = [];
  return {
    calls,
    scrape: async (websiteUrl: string) => {
      calls.push(websiteUrl);
      const totalChars = [...pages.values()].reduce(
        (n, text) => n + text.length,
        0,
      );
      return { pages, pagesHeld: pages.size, totalChars };
    },
  };
}

/** A site that gave us nothing — a 403, a dead host, or a JS shell with no text. */
export function emptyScraper(
  reason: ScrapeFailure = "unreachable",
): FakeScraper {
  const calls: string[] = [];
  return {
    calls,
    scrape: async (websiteUrl: string) => {
      calls.push(websiteUrl);
      return { pages: new Map(), pagesHeld: 0, totalChars: 0, reason };
    },
  };
}

export class FakeExtractClient implements ExtractClient {
  calls: ExtractRequest[] = [];

  constructor(private readonly behaviour: () => Promise<ResearchResponse>) {}

  static fromFixture(fixture: unknown): FakeExtractClient {
    return new FakeExtractClient(async () =>
      parseMessagesResponse(fixture, EXTRACT_MODEL),
    );
  }

  /** A billed 200 whose body is not the JSON the schema promised. */
  static malformed(): FakeExtractClient {
    return new FakeExtractClient(async () => ({
      text: '{"firmographics": { oops',
      usage: {
        inputTokens: 9_000,
        outputTokens: 40,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        webSearchRequests: 0,
        webFetchRequests: 0,
      },
      model: EXTRACT_MODEL,
    }));
  }

  static throwing(error: Error): FakeExtractClient {
    return new FakeExtractClient(async () => {
      throw error;
    });
  }

  async extract(request: ExtractRequest): Promise<ResearchResponse> {
    this.calls.push(request);
    return this.behaviour();
  }
}

/**
 * PDL's response body echoes its own HTTP status, so a recorded fixture already
 * carries the status the meter bills on. A body with no `status` is a shape we do
 * not recognize — which only ever reaches us on a (billed) 200.
 */
export function fixtureHttpStatus(fixture: unknown): number {
  const status = (fixture as { status?: unknown } | null | undefined)?.status;
  return typeof status === "number" ? status : 200;
}

export class FakePdlClient implements PdlClient {
  personCalls: PdlPersonRequest[] = [];
  searchCalls: PdlPersonDiscoveryRequest[] = [];
  companyCalls: number = 0;

  constructor(
    private readonly person: () => Promise<PdlPersonResult>,
    private readonly company: () => Promise<PdlCompanyResult> = async () =>
      normalizeCompanyResponse({ status: 404 }, 404),
    private readonly search: () => Promise<PdlPersonDiscoveryResult> = async () => ({
      billedRecords: 0,
      matched: false,
      unparseable: false,
      parseError: null,
      total: 0,
      confidence: null,
      fullName: null,
      role: null,
      companyName: null,
      workEmail: null,
      linkedinUrl: null,
    }),
  ) {}

  static fromFixture(fixture: unknown): FakePdlClient {
    return new FakePdlClient(async () =>
      normalizePersonResponse(fixture, fixtureHttpStatus(fixture)),
    );
  }

  static withDiscovery(
    discovery: PdlPersonDiscoveryResult,
    personFixture: unknown,
  ): FakePdlClient {
    return new FakePdlClient(
      async () =>
        normalizePersonResponse(
          personFixture,
          fixtureHttpStatus(personFixture),
        ),
      async () => normalizeCompanyResponse({ status: 404 }, 404),
      async () => discovery,
    );
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
      async () => {
        throw error;
      },
    );
  }

  async enrichPerson(request: PdlPersonRequest): Promise<PdlPersonResult> {
    this.personCalls.push(request);
    return this.person();
  }

  async discoverPerson(
    request: PdlPersonDiscoveryRequest,
  ): Promise<PdlPersonDiscoveryResult> {
    this.searchCalls.push(request);
    return this.search();
  }

  async enrichCompany(): Promise<PdlCompanyResult> {
    this.companyCalls += 1;
    return this.company();
  }
}
