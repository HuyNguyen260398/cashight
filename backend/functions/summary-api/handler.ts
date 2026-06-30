import { AggregatedViewSchema } from '@cashight/domain/schemas';
import type { AggregatedView } from '@cashight/domain/aggregations';
import { buildSummaryPayload } from '@cashight/domain/summary-payload';

import { errorResponse, jsonResponse, type ApiResponse } from '../../shared/api-response';
import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import { getAuthorizedUser } from '../../shared/metadata';
import { getSecretString } from '../../shared/secrets';
import { buildPrompt } from './prompt';

export interface SummaryHandlerDeps {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  getApiKey: () => Promise<string | undefined>;
  generateStream: (prompt: string, apiKey: string) => AsyncGenerator<string>;
}

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(msg);
}

export type SummaryResult =
  | { type: 'error'; response: ApiResponse }
  | { type: 'stream'; firstChunk: string; gen: AsyncGenerator<string>; prompt: string };

export async function prepareSummary(
  event: unknown,
  deps: SummaryHandlerDeps,
): Promise<SummaryResult> {
  const requestId =
    (event as { requestContext?: { requestId?: string } }).requestContext?.requestId ??
    'unknown';

  try {
    await authorizeRequest(event, 'cashight/read', {
      getAuthorizedUser: deps.getAuthorizedUser,
    });
  } catch (err) {
    return { type: 'error', response: errorResponse(err, requestId) };
  }

  const rawBody = (event as { body?: string | null }).body ?? '{}';
  let parsed: ReturnType<typeof AggregatedViewSchema.safeParse>;
  try {
    parsed = AggregatedViewSchema.safeParse(JSON.parse(rawBody));
  } catch {
    return {
      type: 'error',
      response: jsonResponse(400, {
        error: { code: 'INVALID_REQUEST', message: 'Invalid request body.', requestId },
      }),
    };
  }

  if (!parsed.success) {
    return {
      type: 'error',
      response: jsonResponse(400, {
        error: { code: 'INVALID_REQUEST', message: 'Invalid aggregated view.', requestId },
      }),
    };
  }

  const view = parsed.data as AggregatedView;

  const apiKey = await deps.getApiKey();
  if (!apiKey) {
    return {
      type: 'error',
      response: jsonResponse(503, {
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'AI summary is not configured.',
          requestId,
        },
      }),
    };
  }

  const payload = buildSummaryPayload(view);
  const prompt = buildPrompt(payload);
  const gen = deps.generateStream(prompt, apiKey);

  let firstResult: IteratorResult<string>;
  try {
    firstResult = await gen.next();
  } catch (err) {
    const statusCode = isRateLimitError(err) ? 429 : 500;
    const code = statusCode === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR';
    const message =
      statusCode === 429
        ? 'AI summary rate limit exceeded. Try again shortly.'
        : 'AI summary generation failed.';
    return {
      type: 'error',
      response: jsonResponse(statusCode, { error: { code, message, requestId } }),
    };
  }

  return {
    type: 'stream',
    firstChunk: firstResult.done ? '' : (firstResult.value ?? ''),
    gen,
    prompt,
  };
}

async function* defaultStream(prompt: string, apiKey: string): AsyncGenerator<string> {
  const { streamSummary } = await import('../../shared/gemini');
  yield* streamSummary(prompt, apiKey);
}

async function defaultGetApiKey(): Promise<string | undefined> {
  const secretId = requiredEnvironmentValue('GEMINI_SECRET_ID');
  try {
    const key = await getSecretString(secretId);
    return key || undefined;
  } catch {
    return undefined;
  }
}

function makeProductionDeps(): SummaryHandlerDeps {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  return {
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    getApiKey: defaultGetApiKey,
    generateStream: defaultStream,
  };
}

type ResponseStream = { write: (chunk: string | Buffer) => void; end: () => void };
type StreamifyResponse = (
  fn: (event: unknown, responseStream: ResponseStream) => Promise<void>,
) => unknown;

async function streamingImpl(event: unknown, responseStream: ResponseStream): Promise<void> {
  const deps = makeProductionDeps();
  const result = await prepareSummary(event, deps);

  if (result.type === 'error') {
    responseStream.write(result.response.body);
    responseStream.end();
    return;
  }

  const { firstChunk, gen } = result;
  if (firstChunk) responseStream.write(firstChunk);
  for await (const chunk of gen) {
    responseStream.write(chunk);
  }
  responseStream.end();
}

// Lambda streaming handler — awslambda is a global available in the Lambda runtime.
// In non-Lambda environments (tests, local), fall back to a plain async function.
function getStreamifyResponse(): StreamifyResponse {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as Record<string, any>;
    if (typeof g.awslambda?.streamifyResponse === 'function') {
      return g.awslambda.streamifyResponse as StreamifyResponse;
    }
  } catch {
    // ignore
  }
  return (fn) => fn;
}

export const handler = getStreamifyResponse()(streamingImpl);
