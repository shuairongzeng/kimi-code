import type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
} from '@zimi-ai/zimi-code-sdk';

export function experimentalFeatureMap(
  features: readonly Pick<ExperimentalFeatureState, 'id' | 'enabled'>[],
): ExperimentalFlagMap {
  return Object.fromEntries(features.map((feature) => [feature.id, feature.enabled]));
}
