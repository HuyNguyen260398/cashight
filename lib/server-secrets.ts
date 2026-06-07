import 'server-only';

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const DEFAULT_REGION = 'ap-southeast-1';
const cache = new Map<string, string | undefined>();

let ssmClient: SSMClient | undefined;

function getRegion(): string {
  return process.env.STORAGE_REGION ?? process.env.AWS_REGION ?? DEFAULT_REGION;
}

function getSsmClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({ region: getRegion() });
  }
  return ssmClient;
}

async function getSecureString(
  parameterEnvName: string,
  fallbackEnvName: string,
): Promise<string | undefined> {
  const parameterName = process.env[parameterEnvName];
  if (!parameterName) return process.env[fallbackEnvName];

  if (cache.has(parameterName)) return cache.get(parameterName);

  const response = await getSsmClient().send(
    new GetParameterCommand({
      Name: parameterName,
      WithDecryption: true,
    }),
  );
  const value = response.Parameter?.Value;
  cache.set(parameterName, value);
  return value;
}

export function getGeminiApiKey(): Promise<string | undefined> {
  return getSecureString('GEMINI_API_KEY_PARAMETER', 'GEMINI_API_KEY');
}

export function getPdfPassword(): Promise<string | undefined> {
  return getSecureString('PDF_PASSWORD_PARAMETER', 'PDF_PASSWORD');
}
