import { beforeAll, describe, expect, it } from 'vitest';

// Signing runs entirely offline, but the SDK still resolves a region and
// credentials before it will produce a URL.
beforeAll(() => {
  process.env.AWS_REGION ??= 'ap-southeast-1';
  process.env.AWS_ACCESS_KEY_ID ??= 'AKIAIOSFODNN7EXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY';
});

const SHA256_BASE64 = Buffer.from('a'.repeat(64), 'hex').toString('base64');

const presignParams = {
  key: 'uploads/aws-invoices/primary/job.pdf',
  sha256Base64: SHA256_BASE64,
  contentType: 'application/pdf',
  size: 1024,
  expiresInSeconds: 300,
};

// getSignedUrl moves ChecksumSHA256 into the URL's query string because it is
// not a signed header. Handing the client an x-amz-checksum-sha256 header to
// attach makes S3 reject the PUT with 403 "headers present which were not
// signed" — the failure fixed once in #85 for statements and reintroduced by
// the invoice pipeline. Both presigners are pinned here so it cannot come back
// through either route.
describe.each([
  ['uploads-api', () => import('../functions/uploads-api/handler')],
  ['aws-invoices-api', () => import('../functions/aws-invoices-api/handler')],
])('%s presigned upload', (_name, load) => {
  it('returns no checksum header for the client to attach', async () => {
    const { createDefaultPresign } = await load();
    const result = await createDefaultPresign('cashight-uploads-test')(
      presignParams,
    );

    const checksumHeaders = Object.keys(result.headers).filter((header) =>
      header.toLowerCase().startsWith('x-amz-checksum'),
    );
    expect(checksumHeaders).toEqual([]);
    expect(Object.keys(result.headers)).toEqual(['Content-Type']);
  });

  it('still enforces the checksum through the signed query string', async () => {
    const { createDefaultPresign } = await load();
    const result = await createDefaultPresign('cashight-uploads-test')(
      presignParams,
    );

    expect(result.url).toContain('x-amz-checksum-sha256');
  });
});
