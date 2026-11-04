import { parseBooleanEnv } from '#/_base/utils/env';

export const TRUST_WORKSPACE_ENV = 'ZIMI_CODE_TRUST_WORKSPACE';

export function trustWorkspaceEnvTrusted(
  getEnv: (name: string) => string | undefined,
): boolean {
  return parseBooleanEnv(getEnv(TRUST_WORKSPACE_ENV)) === true;
}
