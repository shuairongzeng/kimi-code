import {
  loadRuntimeConfigSafe,
  resolveConfigPath,
  resolveZimiHome,
} from '@zimi-ai/zimi-code-sdk';
import {
  createZimiRegionResolver,
  ZIMI_CODE_OAUTH_KEY,
  ZIMI_REGION_PROFILES,
  resolveZimiCodeRuntimeAuth,
  type ZimiRegion,
  type ManagedZimiRuntimeAuth,
  type ZimiRegionAuthRead,
  type ZimiRegionProfile,
  type ZimiRegionResolution,
  type ZimiRegionResolver,
} from '@zimi-ai/zimi-code-oauth';

const MANAGED_ZIMI_CODE_PROVIDER_KEY = 'managed:zimi-code';

export const ZIMI_CODE_GLOBAL_PLATFORM_VALUE = 'zimi-code-global';

export interface PersistedZimiOAuthRef {
  readonly key: string;
  readonly oauthHost?: string;
}

export function persistedZimiOAuthRef(): PersistedZimiOAuthRef | undefined {
  const result = loadRuntimeConfigSafe(resolveConfigPath({}));
  const oauth = result.config.providers?.[MANAGED_ZIMI_CODE_PROVIDER_KEY]?.oauth;
  if (oauth === undefined) return undefined;
  return { key: oauth.key, oauthHost: oauth.oauthHost };
}

export function currentZimiManagedRuntimeAuth(): ManagedZimiRuntimeAuth {
  const config = loadRuntimeConfigSafe(resolveConfigPath({})).config;
  const provider = config.providers?.[MANAGED_ZIMI_CODE_PROVIDER_KEY];
  return resolveZimiCodeRuntimeAuth({
    configuredBaseUrl: provider?.baseUrl,
    configuredOAuthRef: provider?.oauth,
  });
}

function readAuth(): ZimiRegionAuthRead {
  try {
    const result = loadRuntimeConfigSafe(resolveConfigPath({}));
    if (result.fileError !== undefined) return { status: 'unreadable' };
    const ref = result.config.providers?.[MANAGED_ZIMI_CODE_PROVIDER_KEY]?.oauth;
    return ref === undefined ? { status: 'logged-out' } : { status: 'logged-in', ref };
  } catch {
    return { status: 'unreadable' };
  }
}

let resolver: ZimiRegionResolver | undefined;

function regionResolver(): ZimiRegionResolver {
  resolver ??= createZimiRegionResolver({
    homeDir: resolveZimiHome(),
    readAuth,
    authFilePath: resolveConfigPath({}),
    readMarker: process.env['ZIMI_CODE_REGION_MARKER'] !== 'off',
  });
  return resolver;
}

export function regionForBareLogin(ref: PersistedZimiOAuthRef | undefined): ZimiRegion | undefined {
  if (ref === undefined) return currentZimiRegion();
  return ref.key === ZIMI_CODE_OAUTH_KEY ? 'mainland-cn' : undefined;
}

export function currentZimiRegionResolution(): ZimiRegionResolution {
  return regionResolver().current();
}

export function resolveZimiRegionFresh(): ZimiRegionResolution {
  return regionResolver().refresh();
}

export function currentZimiRegion(): ZimiRegion {
  return currentZimiRegionResolution().region;
}

export function currentZimiProfile(): ZimiRegionProfile {
  return ZIMI_REGION_PROFILES[currentZimiRegion()];
}

export function freshZimiProfile(): ZimiRegionProfile {
  return ZIMI_REGION_PROFILES[resolveZimiRegionFresh().region];
}

export function refreshZimiRegion(): ZimiRegion {
  return resolveZimiRegionFresh().region;
}

export function resetZimiRegionCache(): void {
  resolver = undefined;
}
