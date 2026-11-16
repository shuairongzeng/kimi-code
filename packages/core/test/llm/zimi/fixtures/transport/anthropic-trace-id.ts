import { TEST_MODEL, testModule } from '../../../harness';
import type { ZimiAnthropicTransportFixture } from '../types';

export default {
  name: 'zimi-anthropic-trace-id',
  module: testModule({ model: { ...TEST_MODEL, maxOutputTokens: 1024 } }),
  endpoint: { baseUrl: 'https://example.test', apiKey: 'test-key' },
  stream: false,
  response: {
    headers: { 'x-trace-id': 'trace-anthropic' },
    json: {
      id: 'msg-zimi',
      type: 'message',
      role: 'assistant',
      model: 'test-model',
      content: [{ type: 'text', text: 'zimi anthropic' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  },
  expected: {
    url: 'https://example.test/v1/messages',
    body: { stream: false },
    outcome: {
      type: 'done',
      requestId: 'trace-anthropic',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'zimi anthropic' }],
        toolCalls: [],
      },
      messageId: 'msg-zimi',
    },
  },
} satisfies ZimiAnthropicTransportFixture;
