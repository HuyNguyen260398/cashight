'use client';

import { useSyncExternalStore } from 'react';
import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationInput {
  type: NotificationType;
  content: string;
  id?: string;
}

const AUTO_DISMISS_MS = 5_000;

let items: FlashbarProps.MessageDefinition[] = [];
const listeners = new Set<() => void>();
let counter = 0;

function emit() {
  for (const listener of listeners) listener();
}

function dismiss(id: string) {
  items = items.filter((item) => item.id !== id);
  emit();
}

/**
 * Shows a message in the console shell's Flashbar. Callable outside React
 * (hooks, event handlers), replacing sonner's `toast.*`. Errors stay until
 * dismissed; everything else clears after 5 s.
 */
export function notify({ type, content, id }: NotificationInput): void {
  const key = id ?? `notification-${(counter += 1)}`;
  const item: FlashbarProps.MessageDefinition = {
    id: key,
    type,
    content,
    dismissible: true,
    dismissLabel: 'Dismiss',
    onDismiss: () => dismiss(key),
  };
  items = [...items.filter((existing) => existing.id !== key), item];
  emit();
  if (type !== 'error') setTimeout(() => dismiss(key), AUTO_DISMISS_MS);
}

export function clearNotifications(): void {
  items = [];
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => items;
const EMPTY: FlashbarProps.MessageDefinition[] = [];

export function ConsoleNotifications() {
  const current = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return <Flashbar items={current} />;
}
