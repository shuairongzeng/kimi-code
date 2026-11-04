import {
  createZimiRegionResolver,
  ZIMI_CODE_PROVIDER_NAME,
  type ZimiRegion,
  type ZimiRegionResolution,
} from '@zimi-ai/zimi-code-oauth';

import { Disposable } from '#/_base/di/lifecycle';
import { ScopeActivation, registerScopedService } from '#/_base/di/scope';
import { IBootstrapService } from '#/app/bootstrap/bootstrap';
import { LifecycleScope } from '#/app/scopes';
import { IProviderService } from '#/llm-adapter/provider/provider';

import { IRegionService } from './region';

export function zimiRegionEnv(bootstrap: IBootstrapService): NodeJS.ProcessEnv {
  const env = { ...process.env };
  const oauthHost = bootstrap.getEnv('ZIMI_CODE_OAUTH_HOST');
  const legacyOAuthHost = bootstrap.getEnv('ZIMI_OAUTH_HOST');
  const baseUrl = bootstrap.getEnv('ZIMI_CODE_BASE_URL');
  if (oauthHost !== undefined) env['ZIMI_CODE_OAUTH_HOST'] = oauthHost;
  if (legacyOAuthHost !== undefined) env['ZIMI_OAUTH_HOST'] = legacyOAuthHost;
  if (oauthHost === undefined && legacyOAuthHost !== undefined) {
    delete env['ZIMI_CODE_OAUTH_HOST'];
  }
  if (baseUrl !== undefined) env['ZIMI_CODE_BASE_URL'] = baseUrl;
  return env;
}

export class RegionService extends Disposable implements IRegionService {
  declare readonly _serviceBrand: undefined;

  private readonly resolver: ReturnType<typeof createZimiRegionResolver>;
  private providerHydrated = false;

  constructor(
    @IProviderService private readonly providers: IProviderService,
    @IBootstrapService bootstrap: IBootstrapService,
  ) {
    super();
    this.resolver = createZimiRegionResolver({
      homeDir: bootstrap.homeDir,
      env: zimiRegionEnv(bootstrap),
      readMarker:
        (bootstrap.getEnv('ZIMI_CODE_REGION_MARKER') ??
          process.env['ZIMI_CODE_REGION_MARKER']) !== 'off',
      readAuth: () => {
        if (!this.providerHydrated) return { status: 'unreadable' };
        const ref = this.providers.get(ZIMI_CODE_PROVIDER_NAME)?.oauth;
        return ref === undefined ? { status: 'logged-out' } : { status: 'logged-in', ref };
      },
    });
    void this.providers.ready.then(
      () => {
        this.providerHydrated = true;
      },
      () => {
        this.providerHydrated = false;
      },
    );
  }

  current(): ZimiRegionResolution {
    return this.resolver.current();
  }

  async getRegionAsync(): Promise<ZimiRegion> {
    await this.providers.ready.catch(() => undefined);
    return this.resolver.current().region;
  }
}

registerScopedService(
  LifecycleScope.App,
  IRegionService,
  RegionService,
  ScopeActivation.OnScopeCreated,
  'region',
);
