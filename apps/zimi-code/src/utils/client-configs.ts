import { join } from 'node:path';

import { ClientConfigClient } from '@zimi-ai/zimi-code-product/client-configs/node';

import { getCacheDir } from '#/utils/paths';
import { currentZimiRegion } from '#/utils/region';

export const clientConfigs = new ClientConfigClient({
  region: currentZimiRegion,
  baseUrlOverride: () => process.env['ZIMI_CODE_BASE_URL'],
  cacheDir: () => join(getCacheDir(), 'client-configs'),
});
