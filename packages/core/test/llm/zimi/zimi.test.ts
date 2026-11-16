import { describe } from 'vitest';

import {
  zimiAnthropicProtocol,
  zimiOpenAIProtocol,
  zimiResponsesProtocol,
} from '#/llm/builtin/provider/zimi/protocol';

import {
  runDecodeFixtures,
  runEncodeFixtures,
  runTransportFixtures,
} from '../harness';
import { zimiOpenAIDecodeFixtures } from './fixtures/decode';
import {
  zimiAnthropicEncodeFixtures,
  zimiOpenAIEncodeFixtures,
  zimiResponsesEncodeFixtures,
} from './fixtures/encode';
import {
  zimiAnthropicTransportFixtures,
  zimiOpenAITransportFixtures,
  zimiResponsesTransportFixtures,
} from './fixtures/transport';

describe('Zimi OpenAI fixtures', () => {
  runEncodeFixtures(zimiOpenAIProtocol, zimiOpenAIEncodeFixtures);
  runDecodeFixtures(zimiOpenAIProtocol, zimiOpenAIDecodeFixtures);
  runTransportFixtures(zimiOpenAIProtocol, zimiOpenAITransportFixtures);
});

describe('Zimi Responses fixtures', () => {
  runEncodeFixtures(zimiResponsesProtocol, zimiResponsesEncodeFixtures);
  runTransportFixtures(zimiResponsesProtocol, zimiResponsesTransportFixtures);
});

describe('Zimi Anthropic fixtures', () => {
  runEncodeFixtures(zimiAnthropicProtocol, zimiAnthropicEncodeFixtures);
  runTransportFixtures(zimiAnthropicProtocol, zimiAnthropicTransportFixtures);
});
