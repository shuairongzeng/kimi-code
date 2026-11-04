import type { ZimiRegion, ZimiRegionResolution } from '@zimi-ai/zimi-code-oauth';

import { createDecorator, type ServiceIdentifier } from '#/_base/di/instantiation';

export interface IRegionService {
  readonly _serviceBrand: undefined;

  current(): ZimiRegionResolution;
  getRegionAsync(): Promise<ZimiRegion>;
}

export const IRegionService: ServiceIdentifier<IRegionService> =
  createDecorator<IRegionService>('regionService');
