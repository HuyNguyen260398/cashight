import { z } from 'zod';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { describe, expect, it, vi } from 'vitest';

import { errorResponse } from '../shared/api-response';
import {
  authorizeRequest,
  extractAccessClaims,
} from '../shared/auth-claims';
import {
  assertRecordOwner,
  parseStatementMetadataRecord,
} from '../shared/metadata';
import { sanitizeForLog } from '../shared/observability';
import { clearSecretCache, getSecretString } from '../shared/secrets';
import {
  parseStatementObject,
  statementId,
  statementObjectKey,
} from '../shared/storage';

function eventWithClaims(claims: Record<string, unknown>): unknown {
  return { requestContext: { authorizer: { claims } } };
}

const validAuthorizationRecord = {
  PK: 'AUTHZ#user-123',
  SK: 'PROFILE',
  active: true,
  createdAt: '2026-06-27T12:00:00.000Z',
  updatedAt: '2026-06-27T12:00:00.000Z',
} as const;

describe('access-token authorization', () => {
  it('rejects access tokens without a subject', () => {
    expect(() =>
      extractAccessClaims(
        eventWithClaims({ token_use: 'access', scope: 'cashight/read' }),
        'cashight/read',
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects ID tokens', () => {
    expect(() =>
      extractAccessClaims(
        eventWithClaims({
          sub: 'user-123',
          token_use: 'id',
          scope: 'cashight/read',
        }),
        'cashight/read',
      ),
    ).toThrowError(expect.objectContaining({ code: 'UNAUTHORIZED' }));
  });

  it('rejects access tokens without the route scope', () => {
    expect(() =>
      extractAccessClaims(
        eventWithClaims({
          sub: 'user-123',
          token_use: 'access',
          scope: 'openid profile',
        }),
        'cashight/write',
      ),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects inactive authorization records', async () => {
    const getAuthorizedUser = vi.fn().mockResolvedValue({
      ...validAuthorizationRecord,
      active: false,
    });

    await expect(
      authorizeRequest(
        eventWithClaims({
          sub: 'user-123',
          token_use: 'access',
          scope: 'cashight/read cashight/write',
        }),
        'cashight/read',
        { getAuthorizedUser },
      ),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('metadata and storage boundaries', () => {
  it('rejects records owned by another subject', () => {
    expect(() =>
      assertRecordOwner('user-123', { PK: 'USER#different-user' }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects records whose object key belongs to another subject', () => {
    expect(() =>
      assertRecordOwner('user-123', {
        PK: 'USER#user-123',
        objectKey: 'users/different-user/statements/9674/2026/2026-05.json',
      }),
    ).toThrowError(expect.objectContaining({ code: 'FORBIDDEN' }));
  });

  it('rejects malformed statement metadata records', () => {
    expect(() => parseStatementMetadataRecord({ PK: 'USER#user-123' })).toThrow(
      'Invalid statement metadata record',
    );
  });

  it('rejects invalid statement JSON from S3', () => {
    expect(() => parseStatementObject('{"bank":"UNKNOWN"}')).toThrow(
      'Invalid statement object',
    );
  });

  it('builds validated deterministic statement identifiers and keys', () => {
    expect(statementId('9674', 2026, 5)).toBe('2026-05-9674');
    expect(statementObjectKey('user-123', '9674', 2026, 5)).toBe(
      'users/user-123/statements/9674/2026/2026-05.json',
    );
  });

  it.each(['../user', 'user/other', ' user-123', 'user-123 '])(
    'rejects unsafe subject values: %s',
    (sub) => {
      expect(() => statementObjectKey(sub, '9674', 2026, 5)).toThrow(
        'Invalid subject',
      );
    },
  );
});

describe('API error responses', () => {
  it('does not reflect arbitrary exception details', () => {
    const response = errorResponse(
      new Error('PRIVATE MERCHANT DESCRIPTION'),
      'request-123',
    );
    const serialized = JSON.stringify(response);

    expect(response.statusCode).toBe(500);
    expect(response.headers).toEqual({
      'content-type': 'application/json',
      'Access-Control-Allow-Origin': 'https://cashight.nghuy.link',
    });
    expect(serialized.includes('PRIVATE MERCHANT DESCRIPTION')).toBe(false);
    expect(JSON.parse(response.body)).toEqual({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'request-123',
      },
    });
  });

  it('maps Zod errors without returning rejected field values', () => {
    const result = z.object({ value: z.literal('safe') }).safeParse({
      value: 'PRIVATE FIELD VALUE',
    });
    if (result.success) throw new Error('Expected fixture validation to fail');

    const response = errorResponse(result.error, 'request-456');

    expect(response.statusCode).toBe(400);
    expect(JSON.stringify(response).includes('PRIVATE FIELD VALUE')).toBe(false);
    expect(JSON.parse(response.body).error.code).toBe('INVALID_REQUEST');
  });
});

describe('observability privacy', () => {
  it('drops identity and content fields while preserving safe diagnostics', () => {
    const safe = sanitizeForLog({
      email: 'huy@example.com',
      name: 'Huy Test',
      authorization: 'Bearer token-value',
      accessToken: 'access-token-value',
      description: 'PRIVATE MERCHANT DESCRIPTION',
      userName: 'Huy Cognito User',
      jobId: 'job-123',
      cardLast4: '9674',
      count: 2,
    });
    const serialized = JSON.stringify(safe);

    expect(serialized.includes('huy@example.com')).toBe(false);
    expect(serialized.includes('Huy Test')).toBe(false);
    expect(serialized.includes('token-value')).toBe(false);
    expect(serialized.includes('access-token-value')).toBe(false);
    expect(serialized.includes('PRIVATE MERCHANT DESCRIPTION')).toBe(false);
    expect(serialized.includes('Huy Cognito User')).toBe(false);
    expect(safe).toEqual({ jobId: 'job-123', cardLast4: '9674', count: 2 });
  });
});

describe('Secrets Manager adapter', () => {
  it('retrieves and caches secret strings through an injected client', async () => {
    clearSecretCache();
    const send = vi.fn().mockResolvedValue({ SecretString: 'secret-value' });
    const client = { send } as unknown as SecretsManagerClient;

    await expect(getSecretString('secret-id', client)).resolves.toBe(
      'secret-value',
    );
    await expect(getSecretString('secret-id', client)).resolves.toBe(
      'secret-value',
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});
