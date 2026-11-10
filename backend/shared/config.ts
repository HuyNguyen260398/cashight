type Environment = Record<string, string | undefined>;

export const DEFAULT_REGION = 'ap-southeast-1';

export function requiredEnvironmentValue(
  name: string,
  environment: Environment = process.env,
): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`Missing required configuration: ${name}`);
  return value;
}

export function backendRegion(environment: Environment = process.env): string {
  return environment.STORAGE_REGION ?? environment.AWS_REGION ?? DEFAULT_REGION;
}

/**
 * AI summaries are on unless AI_SUMMARY_ENABLED is exactly "false", so v1 and
 * the full v2 platform keep them without setting anything. v2 minimal turns
 * them off (docs/v2-minimal.md).
 */
export function aiSummaryEnabled(environment: Environment = process.env): boolean {
  return environment.AI_SUMMARY_ENABLED !== 'false';
}
