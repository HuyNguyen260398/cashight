type ProcessErrorEvent = 'unhandledRejection' | 'uncaughtException';

export interface ProcessErrorDeps {
  on: (event: ProcessErrorEvent, listener: (reason: unknown) => void) => void;
  log: (message: string, fields: Record<string, string>) => void;
  exit: (code: number) => void;
}

/**
 * A stray rejection or exception leaves the process in an unknown state, so
 * log it and exit 1; Kubernetes restarts the container. Only the error's name
 * is logged: messages can carry statement text (the PCI rule in CLAUDE.md).
 */
export function installProcessErrorHandlers(deps: ProcessErrorDeps): void {
  for (const event of ['unhandledRejection', 'uncaughtException'] as const) {
    deps.on(event, (reason) => {
      const errorName = reason instanceof Error ? reason.name : 'NonError';
      deps.log('process error', { event, errorName });
      deps.exit(1);
    });
  }
}
