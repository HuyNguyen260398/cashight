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
