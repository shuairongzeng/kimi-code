import type { LlmEndpoint } from '#/llm/request';
import { createRequester } from '#/llm/requester';

import { zimiAnthropicFiles, zimiFiles } from './files';
import {
  ZIMI_DEFAULT_BASE_URL,
  zimiAnthropicProtocol,
  zimiOpenAIProtocol,
  zimiResponsesProtocol,
} from './protocol';

export { classifyZimiQuotaError } from './errors';
export { ZIMI_DEFAULT_BASE_URL, zimiAnthropicProtocol, zimiOpenAIProtocol, zimiResponsesProtocol } from './protocol';

const zimiEndpoint: LlmEndpoint = {
  defaultBaseUrl: ZIMI_DEFAULT_BASE_URL,
  files: zimiFiles,
};

const zimiAnthropicEndpoint: LlmEndpoint = {
  defaultBaseUrl: ZIMI_DEFAULT_BASE_URL,
  files: zimiAnthropicFiles,
};

export const zimiRequester = createRequester().with({
  protocol: { base: zimiOpenAIProtocol },
  endpoint: zimiEndpoint,
});

export const zimiAnthropicRequester = createRequester().with({
  protocol: { base: zimiAnthropicProtocol, options: { betaApi: true } },
  endpoint: zimiAnthropicEndpoint,
});

export const zimiResponsesRequester = createRequester().with({
  protocol: { base: zimiResponsesProtocol },
  endpoint: zimiEndpoint,
});

export const zimiRequesters = {
  openai: zimiRequester,
  anthropic: zimiAnthropicRequester,
  openai_responses: zimiResponsesRequester,
} as const;
