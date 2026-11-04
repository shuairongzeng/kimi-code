import { ZIMI_DEFAULT_BASE_URL } from '#/llm/builtin/provider/zimi/protocol';

import type { ProtocolEndpoint, ProtocolEndpointResolver } from './connection';

export const openAIEndpoint: ProtocolEndpoint = {
  apiKeyEnv: 'OPENAI_API_KEY',
  baseUrlEnv: 'OPENAI_BASE_URL',
};

export const anthropicEndpoint: ProtocolEndpoint = {
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  baseUrlEnv: 'ANTHROPIC_BASE_URL',
};

export const geminiEndpoint: ProtocolEndpoint = {
  apiKeyEnv: 'GOOGLE_API_KEY',
  baseUrlEnv: 'GOOGLE_GEMINI_BASE_URL',
};

export const vertexEndpoint: ProtocolEndpoint = {
  apiKeyEnv: 'VERTEXAI_API_KEY',
  baseUrlEnv: 'GOOGLE_VERTEX_BASE_URL',
};

export const ZIMI_API_KEY_ENV = 'ZIMI_API_KEY';
export const ZIMI_BASE_URL_ENV = 'ZIMI_BASE_URL';

export const zimiEndpoint: ProtocolEndpoint = {
  apiKeyEnv: ZIMI_API_KEY_ENV,
  baseUrlEnv: ZIMI_BASE_URL_ENV,
  defaultBaseUrl: ZIMI_DEFAULT_BASE_URL,
};

export const googleGenAIEndpoint: ProtocolEndpointResolver = (ctx) =>
  ctx?.model.vertexai === true ? vertexEndpoint : geminiEndpoint;
