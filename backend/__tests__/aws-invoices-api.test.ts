import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AwsInvoice } from '@cashight/domain/aws-invoices';

import {
  createAwsInvoicesApiHandler,
  type AwsInvoicesApiDependencies,
} from '../functions/aws-invoices-api/handler';
import type {
  AwsInvoiceMetadataRecord,
  AwsInvoiceUploadJobRecord,
} from '../shared/metadata';

const NOW = new Date('2026-08-03T12:00:00.000Z');
const JOB_ID = '8193504f-8e42-43a4-b780-061601a02572';
const SHA256 = 'a'.repeat(64);

const authorizationRecord = {
  PK: 'AUTHZ#user-123' as const,
  SK: 'PROFILE' as const,
  active: true as const,
  workspaceId: 'primary' as const,
  authProvider: 'GOOGLE' as const,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const invoice: AwsInvoice = {
  seller: 'Amazon Web Services, Inc.',
  billingPeriod: { start: '2026-07-01', end: '2026-07-31' },
  invoiceDate: '2026-08-01',
  dueDate: '2026-08-01',
  currency: 'USD',
  totals: { charges: 100, credits: 0, tax: 10, amountDue: 110 },
  services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
  linkedAccounts: [
    {
      accountLast4: '1234',
      charges: 100,
      credits: 0,
      tax: 10,
      total: 110,
      services: [{ name: 'Example Service', charges: 100, tax: 10, total: 110 }],
    },
  ],
  source: {
    parserId: 'aws-inc-consolidated-usd',
    parserVersion: 1,
    sha256: SHA256,
    uploadedAt: NOW.toISOString(),
  },
};

const metadata: AwsInvoiceMetadataRecord = {
  PK: 'WORKSPACE#primary',
  SK: 'AWS_INVOICE#2026-07',
  yearMonth: '2026-07',
  objectKey: 'users/primary/aws-invoices/2026/2026-07.json',
  currency: 'USD',
  amountDue: 110,
  tax: 10,
  serviceCount: 1,
  linkedAccountCount: 1,
  sha256: SHA256,
  parserId: 'aws-inc-consolidated-usd',
  parserVersion: 1,
  uploadedAt: NOW.toISOString(),
};

const job: AwsInvoiceUploadJobRecord = {
  PK: `JOB#${JOB_ID}`,
  SK: 'METADATA',
  documentType: 'AWS_INVOICE',
  owner: { workspaceId: 'primary', subject: 'user-123' },
  state: 'PENDING_UPLOAD',
  sha256: SHA256,
  force: false,
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  expiresAtEpoch: Math.floor(NOW.getTime() / 1000) + 7 * 24 * 60 * 60,
};

function makeDeps(
  overrides: Partial<AwsInvoicesApiDependencies> = {},
): AwsInvoicesApiDependencies {
  return {
    getAuthorizedUser: vi.fn().mockResolvedValue(authorizationRecord),
    putJobRecord: vi.fn().mockResolvedValue(undefined),
    getJobRecord: vi.fn().mockResolvedValue(job),
    presign: vi.fn().mockResolvedValue({
      url: 'https://s3.example.com/private-signature',
      headers: { 'Content-Type': 'application/pdf' },
      expiresAt: '2026-08-03T12:05:00.000Z',
    }),
    queryMetadata: vi.fn().mockResolvedValue({ items: [metadata], nextCursor: null }),
    getMetadata: vi.fn().mockResolvedValue(metadata),
    getInvoiceObject: vi.fn().mockResolvedValue(invoice),
    deleteInvoiceObject: vi.fn().mockResolvedValue(undefined),
    deleteMetadata: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    randomUUID: () => JOB_ID,
    ...overrides,
  };
}

function event(options: {
  method?: string;
  path?: string;
  pathParameters?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  scope?: string;
} = {}): unknown {
  return {
    httpMethod: options.method ?? 'GET',
    path: options.path ?? '/aws/invoices',
    pathParameters: options.pathParameters ?? null,
    queryStringParameters: options.query ?? null,
    body: options.body === undefined ? null : JSON.stringify(options.body),
    requestContext: {
      requestId: 'request-123',
      authorizer: {
        claims: {
          sub: 'user-123',
          token_use: 'access',
          scope: options.scope ?? 'cashight/read cashight/write',
        },
      },
    },
  };
}

const uploadBody = {
  fileName: 'invoice.pdf',
  contentType: 'application/pdf',
  size: 1024,
  sha256: SHA256,
  force: false,
};

describe('AWS invoice uploads and jobs', () => {
  let deps: AwsInvoicesApiDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('requires write scope before creating an upload', async () => {
    const response = await createAwsInvoicesApiHandler(deps)(
      event({ method: 'POST', path: '/aws/invoices/uploads', body: uploadBody, scope: 'cashight/read' }),
    );

    expect(response.statusCode).toBe(403);
    expect(deps.presign).not.toHaveBeenCalled();
  });

  it.each([
    { contentType: 'application/octet-stream' },
    { size: 5 * 1024 * 1024 + 1 },
    { sha256: 'bad' },
  ])('rejects invalid PDF upload input %#', async (override) => {
    const response = await createAwsInvoicesApiHandler(deps)(
      event({
        method: 'POST',
        path: '/aws/invoices/uploads',
        body: { ...uploadBody, ...override },
      }),
    );

    expect(response.statusCode).toBe(400);
  });

  it('creates an owned seven-day job and exact invoice upload prefix', async () => {
    const response = await createAwsInvoicesApiHandler(deps)(
      event({ method: 'POST', path: '/aws/invoices/uploads', body: uploadBody }),
    );

    expect(response.statusCode).toBe(200);
    expect(deps.presign).toHaveBeenCalledWith({
      key: `uploads/aws-invoices/primary/${JOB_ID}.pdf`,
      sha256Base64: Buffer.from(SHA256, 'hex').toString('base64'),
      contentType: 'application/pdf',
      size: 1024,
      expiresInSeconds: 300,
    });
    expect(deps.putJobRecord).toHaveBeenCalledWith(job);
    const body = JSON.parse(response.body);
    expect(body.job).toMatchObject({
      jobId: JOB_ID,
      documentType: 'AWS_INVOICE',
      owner: { workspaceId: 'primary' },
      state: 'PENDING_UPLOAD',
      force: false,
    });
    expect(JSON.stringify(body)).not.toContain('uploads/aws-invoices');
    expect(JSON.stringify(body)).not.toContain(SHA256);
  });

  it('returns an owned job with a month-only conflict', async () => {
    const conflictJob: AwsInvoiceUploadJobRecord = {
      ...job,
      state: 'CONFLICT',
      errorCode: 'INVOICE_CONFLICT',
      conflict: { year: 2026, month: 7 },
    };
    deps = makeDeps({ getJobRecord: vi.fn().mockResolvedValue(conflictJob) });

    const response = await createAwsInvoicesApiHandler(deps)(
      event({
        path: `/aws/invoices/uploads/${JOB_ID}`,
        pathParameters: { jobId: JOB_ID },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).job.conflict).toEqual({ year: 2026, month: 7 });
  });

  it('rejects a job owned by another workspace', async () => {
    deps = makeDeps({
      getJobRecord: vi.fn().mockResolvedValue({
        ...job,
        owner: { workspaceId: 'other', subject: 'other' },
      }),
    });

    const response = await createAwsInvoicesApiHandler(deps)(
      event({
        path: `/aws/invoices/uploads/${JOB_ID}`,
        pathParameters: { jobId: JOB_ID },
      }),
    );

    expect(response.statusCode).toBe(403);
  });
});

describe('AWS invoice list, detail, dashboard, and deletion', () => {
  let deps: AwsInvoicesApiDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = makeDeps();
  });

  it('returns a privacy-safe paginated history list', async () => {
    const nextKey = { PK: 'WORKSPACE#primary', SK: 'AWS_INVOICE#2026-06' };
    deps = makeDeps({
      queryMetadata: vi.fn().mockResolvedValue({ items: [metadata], nextCursor: nextKey }),
    });

    const response = await createAwsInvoicesApiHandler(deps)(event());
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(body.items).toEqual([
      {
        yearMonth: '2026-07',
        currency: 'USD',
        amountDue: 110,
        tax: 10,
        serviceCount: 1,
        linkedAccountCount: 1,
        uploadedAt: NOW.toISOString(),
      },
    ]);
    expect(body.nextCursor).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('objectKey');
    expect(JSON.stringify(body)).not.toContain(SHA256);
  });

  it('rejects a malformed or foreign pagination cursor', async () => {
    const handler = createAwsInvoicesApiHandler(deps);
    const malformed = await handler(event({ query: { cursor: 'not-base64' } }));
    const foreignCursor = Buffer.from(
      JSON.stringify({ PK: 'WORKSPACE#other', SK: 'AWS_INVOICE#2026-07' }),
    ).toString('base64url');
    const foreign = await handler(event({ query: { cursor: foreignCursor } }));

    expect(malformed.statusCode).toBe(400);
    expect(foreign.statusCode).toBe(400);
    expect(deps.queryMetadata).not.toHaveBeenCalled();
  });

  it('returns one owned validated invoice and rejects malformed months', async () => {
    const handler = createAwsInvoicesApiHandler(deps);
    const response = await handler(
      event({ path: '/aws/invoices/2026-07', pathParameters: { yearMonth: '2026-07' } }),
    );
    const invalid = await handler(
      event({ path: '/aws/invoices/../private', pathParameters: { yearMonth: '../private' } }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ invoice });
    expect(invalid.statusCode).toBe(400);
  });

  it('honors an explicit dashboard month and includes historical trend', async () => {
    const older = {
      ...metadata,
      SK: 'AWS_INVOICE#2026-06' as const,
      yearMonth: '2026-06' as const,
      objectKey: 'users/primary/aws-invoices/2026/2026-06.json',
      amountDue: 90,
    };
    deps = makeDeps({
      queryMetadata: vi.fn().mockResolvedValue({ items: [metadata, older], nextCursor: null }),
    });

    const response = await createAwsInvoicesApiHandler(deps)(
      event({ path: '/aws/invoices/dashboard', query: { yearMonth: '2026-07' } }),
    );
    const body = JSON.parse(response.body);

    expect(response.statusCode).toBe(200);
    expect(deps.getMetadata).toHaveBeenCalledWith('primary', '2026-07');
    expect(body.dashboard.monthlyTrend).toEqual([
      { yearMonth: '2026-06', value: 90 },
      { yearMonth: '2026-07', value: 110 },
    ]);
  });

  it('defaults the dashboard to the latest available invoice', async () => {
    const response = await createAwsInvoicesApiHandler(deps)(
      event({ path: '/aws/invoices/dashboard' }),
    );

    expect(response.statusCode).toBe(200);
    expect(deps.getMetadata).toHaveBeenCalledWith('primary', '2026-07');
  });

  it('deletes S3 first and leaves metadata intact when S3 fails', async () => {
    const calls: string[] = [];
    deps = makeDeps({
      deleteInvoiceObject: vi.fn().mockImplementation(async () => {
        calls.push('s3');
        throw new Error('S3 unavailable');
      }),
      deleteMetadata: vi.fn().mockImplementation(async () => {
        calls.push('metadata');
      }),
    });

    const response = await createAwsInvoicesApiHandler(deps)(
      event({
        method: 'DELETE',
        path: '/aws/invoices/2026-07',
        pathParameters: { yearMonth: '2026-07' },
      }),
    );

    expect(response.statusCode).toBe(500);
    expect(calls).toEqual(['s3']);
  });

  it('deletes an owned invoice object before its metadata', async () => {
    const calls: string[] = [];
    deps = makeDeps({
      deleteInvoiceObject: vi.fn().mockImplementation(async () => calls.push('s3')),
      deleteMetadata: vi.fn().mockImplementation(async () => calls.push('metadata')),
    });

    const response = await createAwsInvoicesApiHandler(deps)(
      event({
        method: 'DELETE',
        path: '/aws/invoices/2026-07',
        pathParameters: { yearMonth: '2026-07' },
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(calls).toEqual(['s3', 'metadata']);
  });
});
