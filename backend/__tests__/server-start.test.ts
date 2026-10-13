import { describe, expect, it } from 'vitest';

import { apiConfigFromEnv } from '../server/start-api';
import { workerConfigFromEnv } from '../server/start-worker';

describe('apiConfigFromEnv', () => {
  it('uses the API Gateway throttle values as defaults', () => {
    expect(apiConfigFromEnv({})).toEqual({
      port: 8080,
      rateLimitBurst: 50,
      rateLimitPerSecond: 100,
      shutdownDelayMs: 5_000,
    });
  });

  it('reads overrides', () => {
    expect(
      apiConfigFromEnv({
        PORT: '9000',
        RATE_LIMIT_BURST: '5',
        RATE_LIMIT_PER_SECOND: '2',
        SHUTDOWN_DELAY_MS: '0',
      }),
    ).toEqual({ port: 9000, rateLimitBurst: 5, rateLimitPerSecond: 2, shutdownDelayMs: 0 });
  });

  it.each(['abc', '-1', '1.5', ''])('rejects PORT=%j', (value) => {
    expect(() => apiConfigFromEnv({ PORT: value })).toThrow('Invalid configuration: PORT');
  });
});

describe('workerConfigFromEnv', () => {
  it('reads the queue URL and converts seconds to milliseconds', () => {
    expect(
      workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q', MAX_PROCESSING_SECONDS: '120' }),
    ).toEqual({ queueUrl: 'https://sqs/q', maxProcessingMs: 120_000 });
  });

  it('requires the queue URL', () => {
    expect(() => workerConfigFromEnv({ MAX_PROCESSING_SECONDS: '120' })).toThrow(
      'Missing required configuration: QUEUE_URL',
    );
  });

  it('requires a processing limit', () => {
    expect(() => workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q' })).toThrow(
      'Missing required configuration: MAX_PROCESSING_SECONDS',
    );
  });

  it('refuses a limit at or above the 360 s visibility timeout', () => {
    expect(() =>
      workerConfigFromEnv({ QUEUE_URL: 'https://sqs/q', MAX_PROCESSING_SECONDS: '360' }),
    ).toThrow('Invalid configuration: MAX_PROCESSING_SECONDS');
  });
});
