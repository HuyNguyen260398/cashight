import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AggregatedView } from '@cashight/domain/aggregations';

import {
  prepareSummary,
  type SummaryHandlerDeps,
} from '../functions/summary-api/handler';

const mockAuthorizedRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  createdAt: '2026-06-27T00:00:00.000Z',
  updatedAt: '2026-06-27T00:00:00.000Z',
};

const SENTINEL_DESCRIPTION = 'PRIVATE MERCHANT DESCRIPTION';
const SENTINEL_NAME = 'HUY TEST USER';

const mockAggregatedView: AggregatedView = {
  spec: { type: 'month', year: 2026, month: 5 },
  label: '2026-05',
  statementCount: 1,
  totals: {
    totalSpend: 26986712,
    totalInstallments: 0,
    totalCashback: 519020,
    totalFeesAndInterest: 0,
  },
  transactions: [
    {
      date: '2026-05-15',
      postingDate: '2026-05-16',
      description: SENTINEL_DESCRIPTION,
      category: 'food',
      amountVnd: -150000,
      currency: 'VND',
      originalAmount: 150000,
      isInstallment: false,
      isInternational: false,
    },
  ],
  byCategory: [{ category: 'food', value: 150000, pct: 100 }],
  topMerchants: [{ merchant: 'GROCERY STORE', value: 150000 }],
  subPeriods: [{ label: '2026-05', value: 150000 }],
  installmentSubPeriods: [],
};

async function* mockStream(): AsyncGenerator<string> {
  yield 'First chunk. ';
  yield 'Second chunk.';
}

async function* quotaErrorStream(): AsyncGenerator<string> {
  throw Object.assign(new Error('Rate limit exceeded'), { message: '429 RESOURCE_EXHAUSTED' });
  yield '';
}

function makeDeps(overrides: Partial<SummaryHandlerDeps> = {}): SummaryHandlerDeps {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(mockAuthorizedRecord),
    getApiKey: vi.fn().mockResolvedValue('test-api-key'),
    generateStream: vi.fn().mockImplementation(() => mockStream()),
    ...overrides,
  };
}

function makeEvent(body: unknown, claims: Record<string, unknown> = {}): unknown {
  return {
    httpMethod: 'POST',
    path: '/summaries',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    requestContext: {
      requestId: 'test-request-id',
      authorizer: {
        claims: {
          sub: 'user-123',
          token_use: 'access',
          scope: 'cashight/read cashight/write',
          ...claims,
        },
      },
    },
  };
}

describe('prepareSummary', () => {
  let deps: SummaryHandlerDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('returns 401 for unauthenticated requests', async () => {
    const result = await prepareSummary(
      makeEvent(mockAggregatedView, { sub: undefined, token_use: undefined }),
      deps,
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.response.statusCode).toBe(401);
    }
  });

  it('returns 403 for unauthorized subjects', async () => {
    const result = await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({ getAuthorizedUser: vi.fn().mockResolvedValue(undefined) }),
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.response.statusCode).toBe(403);
    }
  });

  it('returns 400 for invalid aggregated view', async () => {
    const result = await prepareSummary(makeEvent({ invalid: 'data' }), deps);
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.response.statusCode).toBe(400);
    }
  });

  it('returns 503 when Gemini API key is missing', async () => {
    const result = await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({ getApiKey: vi.fn().mockResolvedValue(undefined) }),
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.response.statusCode).toBe(503);
    }
  });

  it('returns 429 when Gemini first chunk throws a quota error', async () => {
    const result = await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({ generateStream: vi.fn().mockImplementation(() => quotaErrorStream()) }),
    );
    expect(result.type).toBe('error');
    if (result.type === 'error') {
      expect(result.response.statusCode).toBe(429);
    }
  });

  it('returns stream result with first chunk for valid request', async () => {
    const result = await prepareSummary(makeEvent(mockAggregatedView), deps);
    expect(result.type).toBe('stream');
    if (result.type === 'stream') {
      expect(result.firstChunk).toBe('First chunk. ');
    }
  });

  it('prompt does not contain raw transaction descriptions', async () => {
    let capturedPrompt = '';
    const result = await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({
        generateStream: vi.fn().mockImplementation((prompt) => {
          capturedPrompt = prompt;
          return mockStream();
        }),
      }),
    );
    expect(result.type).toBe('stream');
    expect(capturedPrompt).not.toContain(SENTINEL_DESCRIPTION);
  });

  it('prompt does not contain cardholder name sentinel', async () => {
    let capturedPrompt = '';
    const viewWithName: AggregatedView = {
      ...mockAggregatedView,
      topMerchants: [{ merchant: SENTINEL_NAME, value: 10000 }],
    };
    // Top merchants may include names — but raw descriptions must not appear
    await prepareSummary(
      makeEvent(viewWithName),
      makeDeps({
        generateStream: vi.fn().mockImplementation((prompt) => {
          capturedPrompt = prompt;
          return mockStream();
        }),
      }),
    );
    // Raw transaction description must not appear
    expect(capturedPrompt).not.toContain(SENTINEL_DESCRIPTION);
  });

  it('prompt contains spend totals and top categories', async () => {
    let capturedPrompt = '';
    await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({
        generateStream: vi.fn().mockImplementation((prompt) => {
          capturedPrompt = prompt;
          return mockStream();
        }),
      }),
    );
    // totals should appear in the prompt
    expect(capturedPrompt).toContain('26986712');
    // top categories
    expect(capturedPrompt).toContain('food');
  });

  it('prompt contains top merchants', async () => {
    let capturedPrompt = '';
    await prepareSummary(
      makeEvent(mockAggregatedView),
      makeDeps({
        generateStream: vi.fn().mockImplementation((prompt) => {
          capturedPrompt = prompt;
          return mockStream();
        }),
      }),
    );
    expect(capturedPrompt).toContain('GROCERY STORE');
  });
});
