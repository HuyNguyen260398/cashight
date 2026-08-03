import { GetParameterCommand, type SSMClient } from '@aws-sdk/client-ssm';

import { ssmClient } from './clients';

// Secret values live in SSM Parameter Store as SecureString parameters rather
// than in Secrets Manager. Standard-tier parameters are free, where Secrets
// Manager bills $0.40 per secret per month; nothing here needs rotation,
// cross-account sharing, or the staging labels that justify the latter.
const secretCache = new Map<string, string>();

export async function getSecretString(
  parameterName: string,
  client: SSMClient = ssmClient,
): Promise<string> {
  const cached = secretCache.get(parameterName);
  if (cached) return cached;

  const result = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const value = result.Parameter?.Value;
  if (!value) {
    throw new Error('Configured parameter has no string value');
  }
  secretCache.set(parameterName, value);
  return value;
}

export function clearSecretCache(): void {
  secretCache.clear();
}
