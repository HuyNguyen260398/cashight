import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseS3Notification } from '../shared/s3-notification';
import { createParserWorkerHandler } from '../functions/parser-worker/handler';
import { createInvoiceParserWorkerHandler } from '../functions/invoice-parser-worker/handler';

// S3 sends this once to a queue when a bucket notification is configured.
// It carries no Records, so it must be acknowledged, not retried into the DLQ.
const TEST_EVENT = JSON.stringify({
  Service: 'Amazon S3',
  Event: 's3:TestEvent',
  Time: '2026-11-08T03:20:00.000Z',
  Bucket: 'cashight-v2-uploads-010382427026',
  RequestId: 'R1',
  HostId: 'H1',
});

const objectEvent = (key: string) =>
  JSON.stringify({ Records: [{ s3: { object: { key } } }] });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseS3Notification', () => {
  it('recognises the s3:TestEvent', () => {
    expect(parseS3Notification(TEST_EVENT)).toEqual({ kind: 'test' });
  });

  it('decodes the object key of an ObjectCreated notification', () => {
    expect(parseS3Notification(objectEvent('uploads/a+b%2Bc.pdf'))).toEqual({
      kind: 'object',
      key: 'uploads/a b+c.pdf',
    });
  });

  it('still rejects a notification with neither a key nor the test event', () => {
    expect(() => parseS3Notification(JSON.stringify({ Records: [] }))).toThrow('No S3 key in notification');
    expect(() => parseS3Notification(JSON.stringify({ Event: 's3:ObjectCreated:Put' }))).toThrow();
  });
});

describe.each([
  ['parser-worker', (job: (key: string) => Promise<void>) => createParserWorkerHandler(job)],
  ['invoice-parser-worker', (job: (key: string) => Promise<void>) => createInvoiceParserWorkerHandler(job)],
])('%s handler', (_name, make) => {
  it('acknowledges the s3:TestEvent without processing or failing it', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const processJob = vi.fn<(key: string) => Promise<void>>(async () => {});

    const response = await make(processJob)({ Records: [{ messageId: 'm-test', body: TEST_EVENT }] });

    expect(processJob).not.toHaveBeenCalled();
    expect(response).toEqual({ batchItemFailures: [] });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm-test', skipped: 's3:TestEvent' }));
  });

  it('still processes object notifications and reports malformed ones', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const processJob = vi.fn<(key: string) => Promise<void>>(async () => {});

    const response = await make(processJob)({
      Records: [
        { messageId: 'm-ok', body: objectEvent('uploads/x.pdf') },
        { messageId: 'm-bad', body: JSON.stringify({ Records: [] }) },
      ],
    });

    expect(processJob).toHaveBeenCalledTimes(1);
    expect(processJob.mock.calls[0][0]).toBe('uploads/x.pdf');
    expect(response).toEqual({ batchItemFailures: [{ itemIdentifier: 'm-bad' }] });
  });
});
