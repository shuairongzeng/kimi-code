import { resolveConfigPath } from '@zimi-ai/agent-core-v2';
import { z } from 'zod';

import { parseConfigString } from '#/config/index';
import { ErrorCodes, ZimiError } from '#/errors';

export type ZimiConfigValidationPathSegment = string | number;

export interface ZimiConfigValidationIssue {
  readonly path: readonly ZimiConfigValidationPathSegment[];
  readonly message: string;
}

export interface ResolveZimiConfigPathInput {
  readonly homeDir?: string | undefined;
  readonly configPath?: string | undefined;
}

export interface ValidateZimiConfigTomlInput {
  readonly text: string;
  readonly filePath?: string | undefined;
}

export interface ZimiConfigRpc {
  resolveConfigPath(input?: ResolveZimiConfigPathInput): Promise<string>;
  validateConfigToml(input: ValidateZimiConfigTomlInput): Promise<void>;
}

export class ZimiConfigRpcClient implements ZimiConfigRpc {
  async resolveConfigPath(input: ResolveZimiConfigPathInput = {}): Promise<string> {
    return resolveConfigPath(input);
  }

  async validateConfigToml(input: ValidateZimiConfigTomlInput): Promise<void> {
    try {
      parseConfigString(input.text, input.filePath);
    } catch (error) {
      const validationIssues = extractValidationIssues(error);
      if (validationIssues !== undefined) {
        throw toConfigValidationError(error, validationIssues);
      }
      throw error;
    }
  }
}

export function createZimiConfigRpc(): ZimiConfigRpc {
  return new ZimiConfigRpcClient();
}

function toConfigValidationError(
  error: unknown,
  validationIssues: readonly ZimiConfigValidationIssue[],
): ZimiError {
  const details =
    error instanceof ZimiError && error.details !== undefined
      ? { ...error.details, validationIssues }
      : { validationIssues };

  if (error instanceof ZimiError) {
    return new ZimiError(error.code, error.message, { details });
  }

  const message = error instanceof Error ? error.message : String(error);
  return new ZimiError(ErrorCodes.CONFIG_INVALID, message, { details });
}

function extractValidationIssues(error: unknown): readonly ZimiConfigValidationIssue[] | undefined {
  const zodError = findZodError(error);
  if (zodError === undefined) return undefined;
  return zodError.issues.map((issue) => ({
    path: issue.path.map((segment) =>
      typeof segment === 'number' ? segment : String(segment),
    ),
    message: issue.message,
  }));
}

function findZodError(error: unknown): z.ZodError | undefined {
  if (error instanceof z.ZodError) return error;
  if (error instanceof Error && error.cause instanceof z.ZodError) return error.cause;
  return undefined;
}
