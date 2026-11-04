import {
  createZimiDefaultHeaders,
  ZIMI_CODE_FLOW_CONFIG,
  ZIMI_CODE_PROVIDER_NAME,
  ZimiOAuthToolkit,
  zimiCodeBaseUrl,
  parseZimiCodeCustomHeaders,
  resolveZimiCodeOAuthRef,
  type ZimiHostIdentity,
  type ManagedZimiOAuthRef,
} from '@zimi-ai/zimi-code-oauth';
import {
  APIStatusError,
  resolveZimiHome,
  UNKNOWN_CAPABILITY,
} from '@zimi-ai/agent-core-v2';

import { ErrorCodes, ZimiError } from '#/errors';
import type { Logger } from '#/logging/index';
import type {
  ModelProvider,
  ProviderConfig as KosongProviderConfig,
  ProviderRequestAuth,
  ResolvedRuntimeProvider,
} from '#/model-provider';
import { mapOAuthTokenError } from '#/oauth-error';

export interface ZimiForCodingProviderOptions extends ZimiHostIdentity {
  readonly homeDir?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly promptCacheKey?: string;
  readonly defaultHeaders?: Record<string, string>;
}

export class ZimiForCodingProvider implements ModelProvider {
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly promptCacheKey: string | undefined;
  private readonly defaultHeaders: Record<string, string> | undefined;
  private readonly toolkit: ZimiOAuthToolkit;
  private readonly homeDir: string;
  private readonly identity: ZimiHostIdentity;
  private readonly oauthRef: ManagedZimiOAuthRef;

  constructor(options: ZimiForCodingProviderOptions) {
    this.model = options.model ?? 'kimi-for-coding';
    this.baseUrl = options.baseUrl ?? zimiCodeBaseUrl();
    this.promptCacheKey = options.promptCacheKey;
    this.defaultHeaders = options.defaultHeaders;
    this.homeDir = resolveZimiHome(options.homeDir);
    this.identity = {
      productName: options.productName,
      version: options.version,
      platform: options.platform,
      userAgentSuffix: options.userAgentSuffix,
    };
    this.oauthRef = resolveZimiCodeOAuthRef({
      oauthHost: ZIMI_CODE_FLOW_CONFIG.oauthHost,
      baseUrl: this.baseUrl,
    });
    this.toolkit = new ZimiOAuthToolkit({
      homeDir: this.homeDir,
      identity: this.identity,
    });
  }

  get defaultModel(): string {
    return this.model;
  }

  resolveProviderConfig(model: string): ResolvedRuntimeProvider {
    if (model !== this.model) {
      throw new ZimiError(
        ErrorCodes.CONFIG_INVALID,
        `Model "${model}" is not supported by ZimiForCodingProvider.`,
      );
    }

    const provider: KosongProviderConfig = {
      type: 'zimi',
      model: this.model,
      baseUrl: this.baseUrl,
      generationKwargs: this.promptCacheKey
        ? { prompt_cache_key: this.promptCacheKey }
        : undefined,
      defaultHeaders: {
        ...parseZimiCodeCustomHeaders(),
        ...createZimiDefaultHeaders({
          homeDir: this.homeDir,
          ...this.identity,
        }),
        ...this.defaultHeaders,
      },
    };

    return {
      providerName: 'kimi-for-coding',
      provider,
      modelCapabilities: UNKNOWN_CAPABILITY,
      type: 'zimi',
      protocol: undefined,
    };
  }

  resolveAuth(_model: string, _options?: { readonly log?: Logger }) {
    return async <T>(request: (auth: ProviderRequestAuth) => Promise<T>): Promise<T> => {
      let auth = await this.buildAuth(false);
      for (let refreshed = false; ; refreshed = true) {
        try {
          return await request(auth);
        } catch (error) {
          const is401 = error instanceof APIStatusError && error.statusCode === 401;
          if (!is401) throw error;
          if (refreshed) {
            throw new ZimiError(
              ErrorCodes.AUTH_LOGIN_REQUIRED,
              'OAuth token was rejected after refresh. Run /login to re-authenticate.',
              { cause: error },
            );
          }
          auth = await this.buildAuth(true);
        }
      }
    };
  }

  private async buildAuth(force: boolean): Promise<ProviderRequestAuth> {
    try {
      const apiKey = await this.toolkit.ensureFresh(ZIMI_CODE_PROVIDER_NAME, {
        force,
        oauthRef: this.oauthRef,
      });
      return { apiKey };
    } catch (error) {
      // Classify OAuth token failures into the public ZimiError protocol so the
      // turn surfaces `auth.login_required` / `provider.connection_error`
      // instead of collapsing everything to `internal`. Unrecognized errors are
      // rethrown raw (see mapOAuthTokenError).
      throw mapOAuthTokenError(error, ZIMI_CODE_PROVIDER_NAME) ?? error;
    }
  }
}
