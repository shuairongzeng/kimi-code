/**
 * Endpoint declarations for built-in providers: the environment variables that supply each provider's
 * API key and base URL, plus Zimi's default base URL.
 */
import type { LlmEndpointDeclaration } from '#/llm/endpoint';
import { ZIMI_DEFAULT_BASE_URL } from '#/llm/builtin/provider/zimi/protocol';

export const openAIEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: 'OPENAI_API_KEY',
  baseUrlEnv: 'OPENAI_BASE_URL',
};

export const anthropicEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: 'ANTHROPIC_API_KEY',
  baseUrlEnv: 'ANTHROPIC_BASE_URL',
};

export const geminiEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: 'GOOGLE_API_KEY',
  baseUrlEnv: 'GOOGLE_GEMINI_BASE_URL',
};

export const vertexEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: 'VERTEXAI_API_KEY',
  baseUrlEnv: 'GOOGLE_VERTEX_BASE_URL',
};

export const bedrockEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: 'AWS_BEARER_TOKEN_BEDROCK',
  baseUrlEnv: 'AWS_BEDROCK_BASE_URL',
};

export const ZIMI_API_KEY_ENV = 'ZIMI_API_KEY';
export const ZIMI_BASE_URL_ENV = 'ZIMI_BASE_URL';

export const zimiEndpoint: LlmEndpointDeclaration = {
  apiKeyEnv: ZIMI_API_KEY_ENV,
  baseUrlEnv: ZIMI_BASE_URL_ENV,
  defaultBaseUrl: ZIMI_DEFAULT_BASE_URL,
};
