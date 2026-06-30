import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { backendRegion } from './config';

const region = backendRegion();

export const s3Client = new S3Client({ region });
export const dynamoDocumentClient = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region }),
  { marshallOptions: { removeUndefinedValues: true } },
);
export const secretsManagerClient = new SecretsManagerClient({ region });
export const sqsClient = new SQSClient({ region });
