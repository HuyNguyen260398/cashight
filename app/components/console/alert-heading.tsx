import type { ReactNode } from 'react';

/** Cloudscape Alert headers aren't headings; keep the h2 these titles used to be. */
export function AlertHeading({ children }: { children: ReactNode }) {
  return (
    <span role="heading" aria-level={2}>
      {children}
    </span>
  );
}
