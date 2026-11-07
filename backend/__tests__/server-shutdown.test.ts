import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApiShutdown, workerExitCode } from '../server/shutdown';

function setup() {
  let closeCallback: (() => void) | undefined;
  const server = {
    close: vi.fn((callback?: () => void) => {
      closeCallback = callback;
      return server;
    }),
    closeIdleConnections: vi.fn(),
    closeAllConnections: vi.fn(),
  };
  const deps = {
    server,
    setNotReady: vi.fn(),
    flushTelemetry: vi.fn(async () => {}),
    delayMs: 5_000,
    hardDeadlineMs: 10_000,
    log: vi.fn(),
    exit: vi.fn(),
  };
  const shutdown = createApiShutdown(deps as unknown as Parameters<typeof createApiShutdown>[0]);
  return { shutdown, deps, server, finishClose: () => closeCallback?.() };
}

describe('createApiShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('marks not ready at once and closes after the delay', () => {
    const { shutdown, deps, server } = setup();

    shutdown('SIGTERM');
    expect(deps.setNotReady).toHaveBeenCalledTimes(1);
    expect(server.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeIdleConnections).toHaveBeenCalledTimes(1);
  });

  it('exits 0 after a clean close', async () => {
    const { shutdown, deps, finishClose } = setup();

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000);
    finishClose();
    await vi.waitFor(() => expect(deps.exit).toHaveBeenCalledWith(0));
    expect(deps.flushTelemetry).toHaveBeenCalledTimes(1);
    expect(deps.exit).toHaveBeenCalledTimes(1);
  });

  it('forces exit after the hard deadline', () => {
    const { shutdown, deps, server } = setup();

    shutdown('SIGTERM');
    vi.advanceTimersByTime(5_000 + 10_000);

    expect(server.closeAllConnections).toHaveBeenCalledTimes(1);
    expect(deps.log).toHaveBeenCalledWith('shutdown deadline exceeded', { hardDeadlineMs: 10_000 });
    expect(deps.exit).toHaveBeenCalledWith(1);
  });

  it('a second signal is ignored', () => {
    const { shutdown, deps, server } = setup();

    shutdown('SIGTERM');
    shutdown('SIGINT');
    vi.advanceTimersByTime(5_000);

    expect(deps.setNotReady).toHaveBeenCalledTimes(1);
    expect(server.close).toHaveBeenCalledTimes(1);
  });
});

describe('workerExitCode', () => {
  it('is 0 without a fatal error and 1 with one', () => {
    expect(workerExitCode({ fatal: false })).toBe(0);
    expect(workerExitCode({ fatal: true })).toBe(1);
  });
});
