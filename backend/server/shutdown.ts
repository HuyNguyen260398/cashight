import type http from 'node:http';

export interface ApiShutdownDeps {
  server: Pick<http.Server, 'close' | 'closeIdleConnections' | 'closeAllConnections'>;
  setNotReady(): void;
  flushTelemetry(): Promise<void>;
  /** Time for the load balancer to stop routing here after readiness fails. */
  delayMs: number;
  /** After close starts, how long in-flight requests may hold the process. */
  hardDeadlineMs: number;
  log(message: string, fields: Record<string, string | number>): void;
  exit(code: number): void;
  setTimer?: typeof setTimeout;
}

/**
 * SIGTERM handling for an API pod: fail readiness at once, keep serving for
 * delayMs while the load balancer drains, then close. A connection that never
 * finishes would otherwise hold the process until the kubelet's SIGKILL, so
 * after hardDeadlineMs every connection is closed and the process exits 1.
 */
export function createApiShutdown(deps: ApiShutdownDeps): (signal: string) => void {
  const setTimer = deps.setTimer ?? setTimeout;
  let shuttingDown = false;
  let exited = false;
  const exit = (code: number): void => {
    if (exited) return;
    exited = true;
    deps.exit(code);
  };

  return (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    deps.setNotReady();
    deps.log('shutting down', { signal });
    setTimer(() => {
      deps.server.close(() => {
        void deps.flushTelemetry().finally(() => exit(0));
      });
      deps.server.closeIdleConnections();
      setTimer(() => {
        deps.log('shutdown deadline exceeded', { hardDeadlineMs: deps.hardDeadlineMs });
        deps.server.closeAllConnections();
        exit(1);
      }, deps.hardDeadlineMs).unref?.();
    }, deps.delayMs);
  };
}

/** A worker that hit a fatal error exits 1 so Kubernetes records the failure. */
export function workerExitCode(state: { fatal: boolean }): 0 | 1 {
  return state.fatal ? 1 : 0;
}
