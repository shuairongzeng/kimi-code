import type { AnthropicOptions, AnthropicRawChunk, AnthropicRawResponse } from '#/llm/builtin/protocol/anthropic/index';
import type { OpenAIOptions, OpenAIRawChunk, OpenAIRawResponse } from '#/llm/builtin/protocol/openai/index';
import type { OpenAIResponsesOptions } from '#/llm/builtin/protocol/openai-responses/index';
import type { DecodeFixture, EncodeFixture, TransportFixture } from '../../harness';

export type ZimiOpenAIEncodeFixture = EncodeFixture<OpenAIOptions>;
export type ZimiResponsesEncodeFixture = EncodeFixture<OpenAIResponsesOptions>;
export type ZimiAnthropicEncodeFixture = EncodeFixture<AnthropicOptions>;
export type ZimiOpenAIDecodeFixture = DecodeFixture<OpenAIOptions, OpenAIRawResponse, OpenAIRawChunk>;
export type ZimiOpenAITransportFixture = TransportFixture<OpenAIOptions>;
export type ZimiResponsesTransportFixture = TransportFixture<OpenAIResponsesOptions>;
export type ZimiAnthropicTransportFixture = TransportFixture<AnthropicOptions>;
