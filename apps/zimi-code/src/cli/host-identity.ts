/**
 * Zimi Code host identity and product User-Agent.
 */

import { createZimiUserAgent, type ZimiHostIdentity } from '@zimi-ai/zimi-code-oauth';

import { CLI_MSH_PLATFORM, CLI_USER_AGENT_PRODUCT } from '#/constant/app';

import { getVersion } from './version';

export function createZimiCodeHostIdentity(version = getVersion()): ZimiHostIdentity {
  return {
    productName: CLI_USER_AGENT_PRODUCT,
    version,
    platform: CLI_MSH_PLATFORM,
  };
}

/**
 * Product User-Agent (`zimi-code-cli/<version>`) for ad-hoc outbound fetches
 * that don't go through the provider pipeline (registry / catalog imports).
 */
export function createZimiCodeUserAgent(version = getVersion()): string {
  return createZimiUserAgent(createZimiCodeHostIdentity(version));
}
