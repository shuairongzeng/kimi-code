import anthropicTraceId from './anthropic-trace-id';
import openAIQuotaError from './openai-quota-error';
import openAITraceId from './openai-trace-id';
import responsesTraceId from './responses-trace-id';

export const zimiOpenAITransportFixtures = [openAITraceId, openAIQuotaError];
export const zimiResponsesTransportFixtures = [responsesTraceId];
export const zimiAnthropicTransportFixtures = [anthropicTraceId];
