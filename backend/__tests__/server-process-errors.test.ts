import { describe, expect, it, vi } from 'vitest';

import { installProcessErrorHandlers } from '../server/process-errors';

type Event = 'unhandledRejection' | 'uncaughtException';

function install() {
  const listeners = new Map<Event, (reason: unknown) => void>();
  const log = vi.fn();
  const exit = vi.fn();
  installProcessErrorHandlers({
    on: (event, listener) => listeners.set(event, listener),
    log,
    exit,
  });
  return { listeners, log, exit };
}

describe('installProcessErrorHandlers', () => {
  it('logs the error name only and exits 1 on an unhandled rejection', () => {
    const { listeners, log, exit } = install();

    listeners.get('unhandledRejection')!(new TypeError('card 4111111111111111'));

    expect(log).toHaveBeenCalledWith('process error', {
      event: 'unhandledRejection',
      errorName: 'TypeError',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('4111');
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('handles a non-Error reason', () => {
    const { listeners, log } = install();

    listeners.get('unhandledRejection')!('boom');

    expect(log).toHaveBeenCalledWith('process error', {
      event: 'unhandledRejection',
      errorName: 'NonError',
    });
  });

  it('uncaughtException behaves the same', () => {
    const { listeners, log, exit } = install();

    listeners.get('uncaughtException')!(new RangeError('statement text'));

    expect(log).toHaveBeenCalledWith('process error', {
      event: 'uncaughtException',
      errorName: 'RangeError',
    });
    expect(exit).toHaveBeenCalledWith(1);
  });
});
