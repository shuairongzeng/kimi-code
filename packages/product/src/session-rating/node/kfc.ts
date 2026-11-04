import { isManagedZimiCodeBaseUrl } from '@zimi-ai/zimi-code-oauth';

export interface RatingModelRoute {
  readonly modelId: string | undefined;
  readonly baseUrl: string | undefined;
}

export function kfcModelIdOf(route: RatingModelRoute): string | undefined {
  if (route.modelId === undefined || !isManagedZimiCodeBaseUrl(route.baseUrl)) return undefined;
  return route.modelId;
}
