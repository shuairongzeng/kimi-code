import { testModule } from '../../../harness';
import type { ZimiOpenAITransportFixture } from '../types';

export default {
  name: 'zimi-openai-trace-id',
  module: testModule(),
  endpoint: { baseUrl: 'https://example.test/v1', apiKey: 'test-key' },
  response: {
    headers: { 'x-trace-id': 'trace-openai' },
    sse: {
      events: [{
        id: 'chat-zimi',
        object: 'chat.completion.chunk',
        created: 0,
        model: 'test-model',
        choices: [{ index: 0, delta: { content: 'zimi' }, finish_reason: 'stop' }],
      }],
    },
  },
  expected: {
    url: 'https://example.test/v1/chat/completions',
    body: { stream: true },
    outcome: {
      type: 'done',
      requestId: 'trace-openai',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'zimi' }],
        toolCalls: [],
      },
    },
  },
} satisfies ZimiOpenAITransportFixture;
