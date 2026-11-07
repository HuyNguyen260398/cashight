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

describe('createApiShutdown with a real server', () => {
  it('lets a keep-alive request in flight at close finish and exits 0 before the deadline', async () => {
    const http = await import('node:http');
    const { createApiServer } = await import('../server/http-server');
    const { jsonResponse } = await import('../shared/api-response');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    let ready = true;
    const server = createApiServer({
      handlers: {
        dashboard: () =>
          new Promise((resolve) => setTimeout(() => resolve(jsonResponse(200, { ok: true })), 300)),
      },
      verifier: { verify: async () => ({ sub: 'u', token_use: 'access', scope: 's' }) },
      rateLimiter: { take: () => true },
      isReady: () => ready,
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };

    const exit = vi.fn();
    const log = vi.fn();
    const shutdown = createApiShutdown({
      server,
      setNotReady: () => {
        ready = false;
      },
      flushTelemetry: async () => {},
      delayMs: 0,
      hardDeadlineMs: 2_000,
      log,
      exit,
    });

    const agent = new http.Agent({ keepAlive: true });
    const status = new Promise<number>((resolve, reject) => {
      http
        .get({ port, host: '127.0.0.1', path: '/dashboard', agent, headers: { Authorization: 'Bearer t' } }, (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        })
        .on('error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    shutdown('SIGTERM');

    expect(await status).toBe(200);
    await vi.waitFor(() => expect(exit).toHaveBeenCalled(), { timeout: 1_500 });
    expect(exit).toHaveBeenCalledWith(0);
    expect(log).not.toHaveBeenCalledWith('shutdown deadline exceeded', expect.anything());
    agent.destroy();
    server.closeAllConnections();
  });
});
