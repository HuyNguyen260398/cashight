import { describe, expect, it } from 'vitest';

import { redactForLog } from '@cashight/domain/security/logging';

describe('redactForLog', () => {
  it('masks PAN-like digit sequences', () => {
    expect(redactForLog('card 4987961234569674 failed')).toBe(
      'card [REDACTED_PAN] failed',
    );
  });

  it('removes known secret keys and preserves safe cardLast4', () => {
    const redacted = redactForLog({
      PDF_PASSWORD: 'secret',
      GEMINI_API_KEY: 'secret',
      AUTH_SECRET: 'secret',
      AUTH_GOOGLE_SECRET: 'secret',
      AUTH_COGNITO_SECRET: 'secret',
      cardLast4: '9674',
      count: 2,
      key: 'statements/9674/2026/2026-05.json',
    });

    expect(redacted).toEqual({
      cardLast4: '9674',
      count: 2,
      key: 'statements/9674/2026/2026-05.json',
    });
  });
});
