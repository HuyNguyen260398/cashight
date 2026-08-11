export function isAwsCostExplorerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AWS_COST_EXPLORER === 'true';
}

export function isAwsBillingInvoiceEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_AWS_BILLING_INVOICE === 'true';
}
