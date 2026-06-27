import {
  GetSecretValueCommand,
  type SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

import { secretsManagerClient } from './clients';

const secretCache = new Map<string, string>();

export async function getSecretString(
  secretId: string,
  client: SecretsManagerClient = secretsManagerClient,
): Promise<string> {
  const cached = secretCache.get(secretId);
  if (cached) return cached;

  const result = await client.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  if (!result.SecretString) {
    throw new Error('Configured secret has no string value');
  }
  secretCache.set(secretId, result.SecretString);
  return result.SecretString;
}

export function clearSecretCache(): void {
  secretCache.clear();
}
