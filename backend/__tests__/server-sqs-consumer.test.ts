import { DeleteMessageCommand, ReceiveMessageCommand } from '@aws-sdk/client-sqs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSqsConsumer, type BatchHandler, type SqsConsumer } from '../server/sqs-consumer';

const QUEUE_URL = 'https://sqs.ap-southeast-1.amazonaws.com/123/parse';

interface Message {
  MessageId?: string;
  Body?: string;
  ReceiptHandle?: string;
}

const message = (id: string): Message => ({
  MessageId: id,
  Body: `{"id":"${id}"}`,
  ReceiptHandle: `rh-${id}`,
});

/**
 * A fake SQS client that hands out the scripted receives, then stops the
 * consumer so `start()` resolves.
 */
function harness(script: Array<Message[] | Error>, handler: BatchHandler, extra = {}) {
  const deleted: string[] = [];
  const receives: Array<Record<string, unknown>> = [];
  const onFatal = vi.fn();
  const sleep = vi.fn(async () => undefined);
  const ref: { consumer?: SqsConsumer } = {};

  const client = {
    async send(command: unknown) {
      if (command instanceof DeleteMessageCommand) {
        deleted.push(command.input.ReceiptHandle as string);
        return {};
      }
      if (command instanceof ReceiveMessageCommand) {
        receives.push(command.input as unknown as Record<string, unknown>);
        const next = script.shift();
        if (next === undefined) {
          ref.consumer?.stop();
          return { Messages: [] };
        }
        if (next instanceof Error) throw next;
        return { Messages: next };
      }
      throw new Error('unexpected command');
    },
  };

  const consumer = createSqsConsumer({
    client,
    queueUrl: QUEUE_URL,
    handler,
    maxProcessingMs: 1_000,
    onFatal,
    sleep,
    ...extra,
  });
  ref.consumer = consumer;
  return { consumer, deleted, receives, onFatal, sleep };
}

const ok: BatchHandler = async () => ({ batchItemFailures: [] });

afterEach(() => vi.restoreAllMocks());

function silenceLogs(): void {
  vi.spyOn(process.stdout, 'write').mockReturnValue(true);
}

describe('createSqsConsumer', () => {
  it('long-polls one message at a time', async () => {
    silenceLogs();
    const { consumer, receives } = harness([], ok);
    await consumer.start();
    expect(receives[0]).toMatchObject({
      QueueUrl: QUEUE_URL,
      MaxNumberOfMessages: 1,
      WaitTimeSeconds: 20,
    });
  });

  it('passes the handler a Lambda-shaped event and deletes on success', async () => {
    silenceLogs();
    const handler = vi.fn(ok);
    const { consumer, deleted } = harness([[message('m1')]], handler);
    await consumer.start();
    expect(handler).toHaveBeenCalledWith({ Records: [{ messageId: 'm1', body: '{"id":"m1"}' }] });
    expect(deleted).toEqual(['rh-m1']);
  });

  it('leaves the message when the handler reports a failure', async () => {
    silenceLogs();
    const { consumer, deleted } = harness([[message('m1')]], async () => ({
      batchItemFailures: [{ itemIdentifier: 'm1' }],
    }));
    await consumer.start();
    expect(deleted).toEqual([]);
  });

  it('leaves the message when the handler throws, and keeps consuming', async () => {
    silenceLogs();
    const handler = vi
      .fn<BatchHandler>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ batchItemFailures: [] });
    const { consumer, deleted } = harness([[message('m1')], [message('m2')]], handler);
    await consumer.start();
    expect(deleted).toEqual(['rh-m2']);
  });

  it('leaves a message that is missing its id, body or receipt handle', async () => {
    silenceLogs();
    const handler = vi.fn(ok);
    const { consumer, deleted } = harness([[{ MessageId: 'm1' }]], handler);
    await consumer.start();
    expect(handler).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });

  it('backs off after a receive error, then continues', async () => {
    silenceLogs();
    const { consumer, deleted, sleep } = harness(
      [new Error('throttled'), [message('m1')]],
      ok,
      { errorBackoffMs: 5_000 },
    );
    await consumer.start();
    expect(sleep).toHaveBeenCalledWith(5_000);
    expect(deleted).toEqual(['rh-m1']);
  });

  it('calls onFatal and does not delete when a job exceeds maxProcessingMs', async () => {
    silenceLogs();
    const { consumer, deleted, onFatal } = harness(
      [[message('m1')]],
      () => new Promise(() => undefined),
      { maxProcessingMs: 10 },
    );
    await consumer.start();
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(onFatal.mock.calls[0][0].message).toContain('exceeded');
    expect(deleted).toEqual([]);
  });

  it('stops consuming after onFatal', async () => {
    silenceLogs();
    const handler = vi.fn<BatchHandler>(() => new Promise(() => undefined));
    const { consumer } = harness([[message('m1')], [message('m2')]], handler, {
      maxProcessingMs: 10,
    });
    await consumer.start();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('lets an in-flight job finish and delete its message when stopped', async () => {
    silenceLogs();
    const inFlight: { release?: () => void } = {};
    const handler = vi.fn<BatchHandler>(
      () =>
        new Promise((resolve) => {
          inFlight.release = () => resolve({ batchItemFailures: [] });
        }),
    );
    const { consumer, deleted } = harness([[message('m1')], [message('m2')]], handler);
    const running = consumer.start();
    await vi.waitFor(() => expect(inFlight.release).toBeDefined());
    consumer.stop();
    inFlight.release?.();
    await running;
    expect(deleted).toEqual(['rh-m1']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('never logs the message body', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const { consumer } = harness([[message('m1')]], async () => {
      throw new Error('boom');
    });
    await consumer.start();
    const logged = write.mock.calls.map((call) => String(call[0])).join('');
    expect(logged).toContain('m1');
    expect(logged).not.toContain('{\\"id\\"');
  });
});
