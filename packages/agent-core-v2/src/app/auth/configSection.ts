import { z } from 'zod';

import {
  type ConfigEffectiveOverlay,
  type ConfigStripEnv,
  type EnvBindings,
  envBindings,
  stripEnvBoundFields,
} from '#/app/config/config';
import { registerConfigOverlay } from '#/app/config/configOverlayContributions';
import { registerConfigSection } from '#/app/config/configSectionContributions';
import {
  camelToSnake,
  cloneRecord,
  isPlainObject,
  plainObjectToToml,
  setDefined,
  snakeToCamel,
  transformPlainObject,
} from '#/app/config/toml';
import { type AssertExact, type Equal } from '#/_base/utils/typeEquality';
import type { OAuthRef } from '#/llm-adapter/provider/provider';

export const SERVICES_SECTION = 'services';

const StringRecordSchema = z.record(z.string(), z.string());

const OAuthRefSchema = z.object({
  storage: z.enum(['file', 'keyring']),
  key: z.string().min(1),
  oauthHost: z.string().min(1).optional(),
});

type _AssertOAuthRef = AssertExact<Equal<z.infer<typeof OAuthRefSchema>, OAuthRef>>;

export const MoonshotServiceConfigSchema = z.object({
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  oauth: OAuthRefSchema.optional(),
  customHeaders: StringRecordSchema.optional(),
});

export type MoonshotServiceConfig = z.infer<typeof MoonshotServiceConfigSchema>;

export const ServicesConfigSchema = z
  .object({
    zimiSearch: MoonshotServiceConfigSchema.optional(),
    zimiFetch: MoonshotServiceConfigSchema.optional(),
  })
  .passthrough();

export type ServicesConfig = z.infer<typeof ServicesConfigSchema>;

export const WEB_SEARCH_BASE_URL_ENV = 'ZIMI_WEB_SEARCH_BASE_URL';
export const WEB_SEARCH_API_KEY_ENV = 'ZIMI_WEB_SEARCH_API_KEY';
export const WEB_FETCH_BASE_URL_ENV = 'ZIMI_WEB_FETCH_BASE_URL';
export const WEB_FETCH_API_KEY_ENV = 'ZIMI_WEB_FETCH_API_KEY';

const nonBlankEnv = (raw: string): string | undefined => {
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const zimiSearchEnvBindings = envBindings(MoonshotServiceConfigSchema, {
  baseUrl: { env: WEB_SEARCH_BASE_URL_ENV, parse: nonBlankEnv },
  apiKey: { env: WEB_SEARCH_API_KEY_ENV, parse: nonBlankEnv },
});

const zimiFetchEnvBindings = envBindings(MoonshotServiceConfigSchema, {
  baseUrl: { env: WEB_FETCH_BASE_URL_ENV, parse: nonBlankEnv },
  apiKey: { env: WEB_FETCH_API_KEY_ENV, parse: nonBlankEnv },
});

export const servicesEnvBindings: EnvBindings<ServicesConfig> = envBindings(
  ServicesConfigSchema,
  {
    zimiSearch: zimiSearchEnvBindings,
    zimiFetch: zimiFetchEnvBindings,
  },
);

const servicesCredentialEnvOverlay: ConfigEffectiveOverlay = {
  apply(effective, getEnv, validate) {
    const services = effective[SERVICES_SECTION];
    if (!isPlainObject(services)) return [];
    const zimiSearch = isolateEnvServiceCredentials(
      services['zimiSearch'],
      getEnv,
      WEB_SEARCH_BASE_URL_ENV,
      WEB_SEARCH_API_KEY_ENV,
    );
    const zimiFetch = isolateEnvServiceCredentials(
      services['zimiFetch'],
      getEnv,
      WEB_FETCH_BASE_URL_ENV,
      WEB_FETCH_API_KEY_ENV,
    );
    if (
      zimiSearch === services['zimiSearch'] &&
      zimiFetch === services['zimiFetch']
    ) {
      return [];
    }
    effective[SERVICES_SECTION] = validate(SERVICES_SECTION, {
      ...services,
      zimiSearch,
      zimiFetch,
    });
    return [SERVICES_SECTION];
  },
};

function isolateEnvServiceCredentials(
  service: unknown,
  getEnv: (name: string) => string | undefined,
  baseUrlEnv: string,
  apiKeyEnv: string,
): unknown {
  const baseUrl = nonBlankEnv(getEnv(baseUrlEnv) ?? '');
  const apiKey = nonBlankEnv(getEnv(apiKeyEnv) ?? '');
  if (baseUrl !== undefined) return { baseUrl, apiKey };
  if (apiKey === undefined) return service;
  if (!isPlainObject(service)) return { apiKey };
  const { apiKey: _apiKey, oauth: _oauth, ...rest } = service;
  return { ...rest, apiKey };
}

const stripMoonshotSearchEnv = stripEnvBoundFields(zimiSearchEnvBindings);
const stripMoonshotFetchEnv = stripEnvBoundFields(zimiFetchEnvBindings);

export const stripServicesEnv: ConfigStripEnv<ServicesConfig> = (value, raw, getEnv) => {
  if (!isPlainObject(value)) return value;
  let out: ServicesConfig | undefined;
  for (const [key, strip] of [
    ['zimiSearch', stripMoonshotSearchEnv],
    ['zimiFetch', stripMoonshotFetchEnv],
  ] as const) {
    const entry = value[key];
    if (entry === undefined) continue;
    const stripped = strip(entry, isPlainObject(raw) ? raw[key] : undefined, getEnv);
    if (stripped === entry) continue;
    out ??= { ...value };
    if (stripped === undefined) {
      delete out[key];
    } else {
      out[key] = stripped;
    }
  }
  return out ?? value;
};

export const servicesFromToml = (rawSnake: unknown): unknown => {
  if (!isPlainObject(rawSnake)) return rawSnake;
  const out: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(rawSnake)) {
    out[snakeToCamel(name)] = isPlainObject(entry) ? serviceEntryFromToml(entry) : entry;
  }
  return out;
};

function serviceEntryFromToml(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    const targetKey = snakeToCamel(key);
    if (targetKey === 'oauth') {
      out[targetKey] = isPlainObject(value) ? transformPlainObject(value) : value;
    } else if (targetKey === 'customHeaders') {
      out[targetKey] = isPlainObject(value) ? cloneRecord(value) : value;
    } else {
      out[targetKey] = value;
    }
  }
  return out;
}

export const servicesToToml = (value: unknown, rawSnake: unknown): unknown => {
  if (!isPlainObject(value)) return value;
  const out = cloneRecord(rawSnake);
  writeService(out, 'zimi_search', value['zimiSearch']);
  writeService(out, 'zimi_fetch', value['zimiFetch']);
  return out;
};

function writeService(out: Record<string, unknown>, snakeKey: string, service: unknown): void {
  if (isPlainObject(service)) {
    out[snakeKey] = serviceEntryToToml(service);
  } else {
    delete out[snakeKey];
  }
}

function serviceEntryToToml(service: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(service)) {
    if (key === 'oauth' && isPlainObject(value)) {
      out[camelToSnake(key)] = plainObjectToToml(value, undefined);
    } else if (key === 'customHeaders' && value !== undefined) {
      out[camelToSnake(key)] = cloneRecord(value);
    } else {
      setDefined(out, camelToSnake(key), value);
    }
  }
  return out;
}

registerConfigSection(SERVICES_SECTION, ServicesConfigSchema, {
  fromToml: servicesFromToml,
  toToml: servicesToToml,
  env: servicesEnvBindings,
  stripEnv: stripServicesEnv,
});
registerConfigOverlay(servicesCredentialEnvOverlay);
