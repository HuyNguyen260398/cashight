'use client';

import type { ReactNode } from 'react';
import { CloudCog } from 'lucide-react';

import { ProtectedRoute } from '@/frontend/auth/protected-route';

export function AwsDashboardPlaceholder({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <ProtectedRoute>
      <main className="space-y-6">
        <header className="rounded-2xl border border-gray-200 bg-white p-6 shadow-theme-xs dark:border-gray-800 dark:bg-white/[0.03]">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 dark:bg-brand-500/15 dark:text-brand-400">
              <CloudCog className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-sm font-medium text-brand-500 dark:text-brand-400">
                {eyebrow}
              </p>
              <h1 className="mt-1 text-2xl font-semibold text-gray-900 dark:text-white/90">
                {title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-gray-600 dark:text-gray-400">
                {description}
              </p>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center dark:border-gray-700 dark:bg-white/[0.03]">
          {children}
        </section>
      </main>
    </ProtectedRoute>
  );
}
