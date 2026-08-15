import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isAwsBillingInvoiceEnabled,
  isAwsCostExplorerEnabled,
} from '../config/features';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('public feature flags', () => {
  it('keeps Cost Explorer disabled unless the build flag is exactly true', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER', '');
    expect(isAwsCostExplorerEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER', 'false');
    expect(isAwsCostExplorerEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER', 'TRUE');
    expect(isAwsCostExplorerEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER', 'true');
    expect(isAwsCostExplorerEnabled()).toBe(true);
  });

  it('keeps AWS billing invoices disabled unless the build flag is exactly true', () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE', '');
    expect(isAwsBillingInvoiceEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE', 'false');
    expect(isAwsBillingInvoiceEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE', 'TRUE');
    expect(isAwsBillingInvoiceEnabled()).toBe(false);

    vi.stubEnv('NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE', 'true');
    expect(isAwsBillingInvoiceEnabled()).toBe(true);
  });
});
