import { requiredEnvironmentValue } from '../shared/config';

type Environment = Record<string, string | undefined>;

/**
 * Throws `Missing required configuration: <NAME>` for the first name that is
 * unset or blank. Handlers read these per invocation, so without this check a
 * manifest typo only shows up as a 500 on every request or a DLQ full of jobs.
 */
export function assertRequiredEnv(
  names: readonly string[],
  env: Environment = process.env,
): void {
  for (const name of names) requiredEnvironmentValue(name, env);
}
