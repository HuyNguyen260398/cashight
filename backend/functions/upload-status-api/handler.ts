import { authorizeRequest } from '../../shared/auth-claims';
import { dynamoDocumentClient } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  getAuthorizedUser,
  getUploadJobRecord,
  type UploadJobRecord,
} from '../../shared/metadata';
import { errorResponse, jsonResponse, ApiError, type ApiResponse } from '../../shared/api-response';

export interface UploadStatusApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  getJobRecord: (jobId: string) => Promise<UploadJobRecord | undefined>;
}

function jobToResponse(record: UploadJobRecord) {
  const jobId = record.PK.replace('JOB#', '');
  return {
    jobId,
    state: record.state,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.errorCode !== undefined ? { errorCode: record.errorCode } : {}),
    ...(record.statementId !== undefined ? { statementId: record.statementId } : {}),
    ...(record.conflict !== undefined ? { conflict: record.conflict } : {}),
  };
}

export function createUploadStatusApiHandler(deps: UploadStatusApiDependencies) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext?.requestId ??
      'unknown';

    try {
      const { claims } = await authorizeRequest(event, 'cashight/read', {
        getAuthorizedUser: deps.getAuthorizedUser,
      });

      const pathParams = (event as { pathParameters?: { jobId?: string } | null })
        .pathParameters;
      const jobId = pathParams?.jobId;
      if (!jobId) {
        throw new ApiError('INVALID_REQUEST', 400, 'Missing jobId path parameter.');
      }

      const record = await deps.getJobRecord(jobId);
      if (!record) {
        throw new ApiError('NOT_FOUND', 404, 'Upload job not found.');
      }

      if (record.sub !== claims.sub) {
        throw new ApiError('FORBIDDEN', 403, 'Access denied.');
      }

      return jsonResponse(200, { job: jobToResponse(record) });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const statusHandler = createUploadStatusApiHandler({
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    getJobRecord: (jobId) => getUploadJobRecord(dynamoDocumentClient, tableName, jobId),
  });
  return statusHandler(event);
}
