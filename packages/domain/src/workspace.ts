import { z } from 'zod';

export const AuthProviderSchema = z.enum(['COGNITO', 'GOOGLE']);
export type AuthProvider = z.infer<typeof AuthProviderSchema>;

export const WorkspaceIdSchema = z.literal('primary');
export type WorkspaceId = z.infer<typeof WorkspaceIdSchema>;

export const AuthorizedWorkspaceSchema = z.object({
  workspaceId: WorkspaceIdSchema,
  authProvider: AuthProviderSchema,
});
export type AuthorizedWorkspace = z.infer<typeof AuthorizedWorkspaceSchema>;

export const SessionCapabilitiesSchema = z.object({
  canViewAwsCosts: z.boolean(),
  reason: z.literal('COGNITO_REAUTH_REQUIRED').optional(),
});
export type SessionCapabilities = z.infer<typeof SessionCapabilitiesSchema>;
