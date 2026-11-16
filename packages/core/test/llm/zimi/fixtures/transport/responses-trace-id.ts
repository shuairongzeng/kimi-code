import { testModule } from '../../../harness';
import type { ZimiResponsesTransportFixture } from '../types';

export default {
  name: 'zimi-responses-trace-id',
  module: testModule(),
  endpoint: { baseUrl: 'https://example.test/v1', apiKey: 'test-key' },
  response: {
    headers: { 'x-trace-id': 'trace-responses' },
    sse: {
      events: [
        { type: 'response.output_text.delta', delta: 'zimi responses' },
        {
          type: 'response.completed',
          response: { id: 'resp-zimi', status: 'completed' },
        },
      ],
    },
  },
  expected: {
    url: 'https://example.test/v1/responses',
    body: { stream: true, store: false },
    outcome: {
      type: 'done',
      requestId: 'trace-responses',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'zimi responses' }],
        toolCalls: [],
      },
      messageId: 'resp-zimi',
    },
  },
} satisfies ZimiResponsesTransportFixture;
