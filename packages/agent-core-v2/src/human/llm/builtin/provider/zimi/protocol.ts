import type { Message, ToolDescription, ContentPart } from '#/llm/message';
import { providerImagePolicy } from '#/llm/protocol/kit/media';
import { requestIdFromHeader } from '#/llm/protocol/kit/http';
import type { Decoder, LlmErrorDiagnosticsInput } from '#/llm/protocol/protocol';
import type { LlmModelSpec, ThinkingRequestOptions } from '#/llm/request';
import { llmStatusErrorMessage, type LlmRemoteErrorMessage } from '#/llm/response';
import {
  anthropicProtocol,
  CONTEXT_MANAGEMENT_BETA,
  lowerMessage as lowerAnthropicMessage,
} from '#/llm/builtin/protocol/anthropic/index';
import {
  lowerMessage as lowerOpenAIMessage,
  openAIModelLegality,
  openAIProtocol,
  resolveOpenAIReasoningKey,
  type OpenAINativeMessage,
  type OpenAINativeToolCall,
  type OpenAILowerContext,
  type OpenAIRawChunk,
  type OpenAIRawUsage,
} from '#/llm/builtin/protocol/openai/index';
import {
  openAIResponsesModelLegality,
  openAIResponsesProtocol,
} from '#/llm/builtin/protocol/openai-responses/index';

import { classifyZimiQuotaError } from './errors';
import { normalizeZimiToolSchema } from './schema';

export const ZIMI_DEFAULT_BASE_URL = 'https://api.moonshot.ai/v1';

export interface ZimiThinkingConfig {
  type?: 'enabled' | 'disabled';
  effort?: string;
  keep?: unknown;
  [key: string]: unknown;
}

function isEffectivelyEmptyContent(parts: readonly ContentPart[]): boolean {
  for (const part of parts) {
    if (part.type !== 'text') {
      return false;
    }
    if (part.text.trim() !== '') {
      return false;
    }
  }
  return true;
}

function convertZimiTool(tool: ToolDescription): Record<string, unknown> {
  if (tool.name.startsWith('$')) {
    return {
      type: 'builtin_function',
      function: { name: tool.name },
    };
  }
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeZimiToolSchema(tool.parameters),
    },
  };
}

function fillZimiMaxOutputTokens(
  model: LlmModelSpec,
  usedTokens: number | undefined,
): number | undefined {
  const window = model.maxContextSize;
  if (window === undefined || window <= 0 || usedTokens === undefined) return undefined;
  return Math.max(1, window - usedTokens);
}

function zimiOpenAIThinkingParams(thinking: ThinkingRequestOptions): Record<string, unknown> {
  const config: ZimiThinkingConfig =
    thinking.effort === 'off'
      ? { type: 'disabled' }
      : thinking.effort === 'on'
        ? { type: 'enabled' }
        : { type: 'enabled', effort: thinking.effort };
  if (thinking.keep !== undefined) {
    config.keep = thinking.keep;
  }
  return { thinking: config };
}

function applyZimiMessageExtras(
  message: Message,
  native: OpenAINativeMessage,
): OpenAINativeMessage {
  const record = native as Partial<OpenAINativeMessage> & Record<string, unknown>;
  if (message.role === 'assistant' && message.toolCalls.length > 0) {
    const nonThinkParts = message.content.filter((part) => part.type !== 'think');
    if (isEffectivelyEmptyContent(nonThinkParts)) {
      delete record['content'];
    }
  }
  if (message.role === 'system' && message.tools !== undefined && message.tools.length > 0) {
    record['tools'] = message.tools.map((tool) => convertZimiTool(tool));
  }
  const convertedToolCalls = record['tool_calls'];
  if (message.role === 'assistant' && Array.isArray(convertedToolCalls)) {
    message.toolCalls.forEach((toolCall, index) => {
      if (toolCall.extras === undefined) {
        return;
      }
      const out: (OpenAINativeToolCall & { extras?: unknown }) | undefined =
        convertedToolCalls[index];
      if (out !== undefined) {
        out.extras = toolCall.extras;
      }
    });
  }
  return native;
}

function hoistZimiUsage(chunk: OpenAIRawChunk): OpenAIRawChunk {
  if (chunk.usage !== null && chunk.usage !== undefined && typeof chunk.usage === 'object') {
    return chunk;
  }
  const firstChoice = chunk.choices?.[0] as { usage?: OpenAIRawUsage | null } | undefined;
  const choiceUsage = firstChoice?.usage;
  if (choiceUsage === null || choiceUsage === undefined || typeof choiceUsage !== 'object') {
    return chunk;
  }
  return { ...chunk, usage: choiceUsage };
}

const zimiImageMimes = providerImagePolicy('zimi').acceptedMimes;

function withZimiErrors(base: {
  readonly decodeError: (error: unknown, source?: 'stream') => LlmRemoteErrorMessage;
}) {
  return (error: unknown, source?: 'stream') =>
    source === 'stream'
      ? base.decodeError(error, source)
      : (classifyZimiQuotaError(error) ?? base.decodeError(error, source));
}

function diagnoseZimiError({ error, headers }: LlmErrorDiagnosticsInput) {
  const currentHeaders = headers ?? llmStatusErrorMessage(error)?.headers ?? undefined;
  const requestId =
    currentHeaders === undefined ? undefined : requestIdFromHeader('x-trace-id')(currentHeaders);
  return requestId === undefined ? {} : { requestId };
}

export const zimiOpenAIProtocol = openAIProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  diagnoseError: diagnoseZimiError,
  legality: {
    ...openAIModelLegality,
    fillMaxOutputTokens: fillZimiMaxOutputTokens,
  },
  thinking: (thinking) => (thinking === undefined ? undefined : zimiOpenAIThinkingParams(thinking)),
  maxOutputTokens: (cap) => ({ max_completion_tokens: cap }),
  tool: convertZimiTool,
  message: (message, module) => {
    const ctx: OpenAILowerContext = {
      reasoningKey: resolveOpenAIReasoningKey(
        module.content.messages,
        module.options?.reasoningKey,
        module.options?.detectedReasoningKey,
      ),
      preserveThinking:
        module.model.thinking?.keep === 'all' && module.model.thinking?.effort !== 'off',
      toolMessageConversion: module.options?.toolMessageConversion ?? 'keep_parts',
    };
    return lowerOpenAIMessage(message, ctx).map((native) => applyZimiMessageExtras(message, native));
  },
  decoder: (module, sink): Decoder<OpenAIRawChunk> => {
    const inner = base.decoder(module, sink);
    return {
      push: (chunk) => inner.push(hoistZimiUsage(chunk)),
      end: () => inner.end(),
    };
  },
  flatten: (native, module) => {
    const { extra_body: extraBody, ...extras } = module.options?.extras ?? {};
    const options = { ...module.options, extras: { ...extras, ...extraBody } };
    return base.flatten(native, { ...module, options });
  },
  decodeError: withZimiErrors(base),
}));

export const zimiAnthropicProtocol = anthropicProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  diagnoseError: diagnoseZimiError,
  thinking: (thinking) =>
    thinking === undefined
      ? undefined
      : thinking.effort === 'off'
        ? { thinking: { type: 'disabled' }, betaFeatures: [CONTEXT_MANAGEMENT_BETA] }
        : {
            thinking: { type: 'enabled' },
            output_config: thinking.effort === 'on' ? undefined : { effort: thinking.effort },
            betaFeatures: [CONTEXT_MANAGEMENT_BETA],
          },
  message: (message) => lowerAnthropicMessage(message, zimiImageMimes),
  decodeError: withZimiErrors(base),
}));

export const zimiResponsesProtocol = openAIResponsesProtocol.with((base) => ({
  requestId: requestIdFromHeader('x-trace-id'),
  diagnoseError: diagnoseZimiError,
  legality: {
    ...openAIResponsesModelLegality,
    fillMaxOutputTokens: fillZimiMaxOutputTokens,
  },
  decodeError: withZimiErrors(base),
}));

