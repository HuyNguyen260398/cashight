import { SessionCapabilitiesSchema } from '@cashight/domain/workspace';

import {
  errorResponse,
  jsonResponse,
  type ApiResponse,
} from '../../shared/api-response';
import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import { getAuthorizedUser } from '../../shared/metadata';

export interface SessionCapabilitiesApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
}

export function createSessionCapabilitiesApiHandler(
  deps: SessionCapabilitiesApiDependencies,
) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext
        ?.requestId ?? 'unknown';

    try {
      const { authorization } = await authorizeRequest(
        event,
        'cashight/read',
        { getAuthorizedUser: deps.getAuthorizedUser },
      );
      const capabilities =
        authorization.authProvider === 'COGNITO'
          ? { canViewAwsCosts: true as const }
          : {
              canViewAwsCosts: false as const,
              reason: 'COGNITO_REAUTH_REQUIRED' as const,
            };
      return jsonResponse(200, SessionCapabilitiesSchema.parse(capabilities));
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  return createSessionCapabilitiesApiHandler({
    getAuthorizedUser: (sub) =>
      getAuthorizedUser(dynamoDocumentClient, tableName, sub),
  })(event);
}
