export function isAwsCostExplorerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER === 'true';
}

export function isAwsBillingInvoiceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE === 'true';
}

/** On unless the build sets the flag to exactly "false" (v2 minimal does). */
export function isAiSummaryEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AI_SUMMARY !== 'false';
}
