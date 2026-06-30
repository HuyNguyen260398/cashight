import { dynamoDocumentClient } from '../../shared/clients';
import { requiredEnvironmentValue } from '../../shared/config';
import {
  upsertAuthorizedUser as writeAuthorizedUser,
  type AuthorizedUserRecord,
} from '../../shared/metadata';

interface CognitoAuthGuardEvent {
  triggerSource: string;
  request: {
    userAttributes: Record<string, string | undefined>;
  };
  response: Record<string, unknown>;
}

interface AuthGuardDependencies {
  allowedEmail: string;
  upsertAuthorizedUser: (record: AuthorizedUserRecord) => Promise<void>;
  now?: () => Date;
}

const COGNITO_SUBJECT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function normalizeEmail(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

export function createAuthGuardHandler({
  allowedEmail,
  upsertAuthorizedUser,
  now = () => new Date(),
}: AuthGuardDependencies) {
  const normalizedAllowedEmail = normalizeEmail(allowedEmail);

  return async <T extends CognitoAuthGuardEvent>(event: T): Promise<T> => {
    const attributes = event.request.userAttributes;
    const email = normalizeEmail(attributes.email);
    const isVerified = attributes.email_verified === 'true';
    const isGuardedTrigger =
      event.triggerSource === 'PreSignUp_ExternalProvider' ||
      event.triggerSource.startsWith('TokenGeneration_');

    if (!isGuardedTrigger) return event;
    if (
      !normalizedAllowedEmail ||
      !isVerified ||
      email !== normalizedAllowedEmail
    ) {
      throw new Error('AccessDenied');
    }

    if (event.triggerSource.startsWith('TokenGeneration_')) {
      const sub = attributes.sub?.trim() ?? '';
      if (!COGNITO_SUBJECT_RE.test(sub)) throw new Error('AccessDenied');
      const timestamp = now().toISOString();
      await upsertAuthorizedUser({
        PK: `AUTHZ#${sub}`,
        SK: 'PROFILE',
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }

    return event;
  };
}

export async function handler(
  event: CognitoAuthGuardEvent,
): Promise<CognitoAuthGuardEvent> {
  const tableName = requiredEnvironmentValue('TABLE_NAME');
  const authGuard = createAuthGuardHandler({
    allowedEmail: requiredEnvironmentValue('ALLOWED_EMAIL'),
    upsertAuthorizedUser: (record) =>
      writeAuthorizedUser(dynamoDocumentClient, tableName, record),
  });
  return authGuard(event);
}
