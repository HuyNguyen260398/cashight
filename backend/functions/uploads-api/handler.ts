import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { CreateUploadRequestSchema } from '@cashight/domain/api';

import { authorizeRequest } from '../../shared/auth-claims';
import { s3Client, dynamoDocumentClient } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  getAuthorizedUser,
  putUploadJobRecord,
  type UploadJobRecord,
} from '../../shared/metadata';
import { errorResponse, jsonResponse, type ApiResponse } from '../../shared/api-response';

export interface PresignResult {
  url: string;
  headers: Record<string, string>;
  expiresAt: string;
}

export interface UploadsApiDependencies {
  getAuthorizedUser: (sub: string) => Promise<unknown>;
  putJobRecord: (record: UploadJobRecord) => Promise<void>;
  presign: (params: {
    key: string;
    sha256Base64: string;
    contentType: string;
    size: number;
  }) => Promise<PresignResult>;
  now: () => Date;
}

const UPLOAD_EXPIRY_SECONDS = 300; // 5 minutes
const JOB_TTL_SECONDS = 7 * 24 * 60 * 60;

export function createUploadsApiHandler(deps: UploadsApiDependencies) {
  return async (event: unknown): Promise<ApiResponse> => {
    const requestId =
      (event as { requestContext?: { requestId?: string } }).requestContext?.requestId ??
      'unknown';

    try {
      const { claims } = await authorizeRequest(event, 'cashight/write', {
        getAuthorizedUser: deps.getAuthorizedUser,
      });

      const rawBody = (event as { body?: string | null }).body ?? '{}';
      const parsed = CreateUploadRequestSchema.safeParse(JSON.parse(rawBody));
      if (!parsed.success) {
        return jsonResponse(400, {
          error: { code: 'INVALID_REQUEST', message: 'The request is invalid.', requestId },
        });
      }

      const { contentType, size, sha256, force } = parsed.data;
      const jobId = crypto.randomUUID();
      const now = deps.now();
      const timestamp = now.toISOString();
      const expiresAtEpoch = Math.floor(now.getTime() / 1000) + JOB_TTL_SECONDS;

      const key = `uploads/${claims.sub}/${jobId}.pdf`;
      const sha256Base64 = Buffer.from(sha256, 'hex').toString('base64');

      const presigned = await deps.presign({ key, sha256Base64, contentType, size });

      const record: UploadJobRecord = {
        PK: `JOB#${jobId}`,
        SK: 'METADATA',
        sub: claims.sub,
        state: 'PENDING_UPLOAD',
        sha256,
        force,
        createdAt: timestamp,
        updatedAt: timestamp,
        expiresAtEpoch,
      };

      await deps.putJobRecord(record);

      return jsonResponse(200, {
        job: {
          jobId,
          state: 'PENDING_UPLOAD',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        upload: {
          url: presigned.url,
          method: 'PUT',
          headers: presigned.headers,
          expiresAt: presigned.expiresAt,
        },
      });
    } catch (err) {
      return errorResponse(err, requestId);
    }
  };
}

function createDefaultPresign(uploadBucket: string) {
  return async (params: {
    key: string;
    sha256Base64: string;
    contentType: string;
    size: number;
  }): Promise<PresignResult> => {
    const expiresAt = new Date(Date.now() + UPLOAD_EXPIRY_SECONDS * 1000).toISOString();
    const command = new PutObjectCommand({
      Bucket: uploadBucket,
      Key: params.key,
      ContentType: params.contentType,
      ContentLength: params.size,
      ChecksumSHA256: params.sha256Base64,
    });
    const url = await getSignedUrl(s3Client, command, { expiresIn: UPLOAD_EXPIRY_SECONDS });
    return {
      url,
      headers: {
        'Content-Type': params.contentType,
        'x-amz-checksum-sha256': params.sha256Base64,
      },
      expiresAt,
    };
  };
}

export async function handler(event: unknown): Promise<ApiResponse> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const uploadBucket = requiredEnvironmentValue('UPLOAD_BUCKET');
  const uploadsHandler = createUploadsApiHandler({
    getAuthorizedUser: (sub) => getAuthorizedUser(dynamoDocumentClient, tableName, sub),
    putJobRecord: (record) => putUploadJobRecord(dynamoDocumentClient, tableName, record),
    presign: createDefaultPresign(uploadBucket),
    now: () => new Date(),
  });
  return uploadsHandler(event);
}
