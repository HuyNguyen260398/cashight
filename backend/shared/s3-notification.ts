/**
 * Parses the body of an SQS message carrying an S3 event notification.
 *
 * S3 sends one `s3:TestEvent` to the queue when a bucket notification is
 * configured. It has no `Records`, so a worker must acknowledge it rather
 * than fail it into the dead-letter queue.
 */
export type S3NotificationMessage = { kind: 'test' } | { kind: 'object'; key: string };

interface S3NotificationBody {
  Event?: string;
  Records?: Array<{ s3?: { object?: { key?: string } } }>;
}

export function parseS3Notification(body: string): S3NotificationMessage {
  const notification = JSON.parse(body) as S3NotificationBody;
  if (notification.Event === 's3:TestEvent') return { kind: 'test' };

  const key = notification.Records?.[0]?.s3?.object?.key;
  if (!key) throw new Error('No S3 key in notification');
  // S3 URL-encodes keys in notifications, with spaces as '+'.
  return { kind: 'object', key: decodeURIComponent(key.replace(/\+/g, ' ')) };
}
