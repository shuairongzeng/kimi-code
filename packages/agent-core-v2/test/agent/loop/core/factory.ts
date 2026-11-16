import { createLoop, type CreateLoopOptions, type Loop } from '@zimi-ai/core/loop/index';

export function createTestLoop(options: CreateLoopOptions): Loop {
  return createLoop(options);
}
