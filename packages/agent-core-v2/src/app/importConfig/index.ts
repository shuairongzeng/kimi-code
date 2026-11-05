/**
 * Import third-party coding-agent configuration (omp / kimi-code / pi / zcode)
 * into Zimi Code's provider & model config.
 *
 * Pipeline: reader(source) → IR → converter → ZimiConfigPatch (persisted by
 * the caller via the node-sdk `setConfig`, which writes config.toml with the
 * comment-preserving TOML writeback).
 */

export type ImportProtocol = 'anthropic' | 'openai' | 'openai_responses' | 'google-genai';

export interface ImportModel {
  readonly id: string;
  readonly displayName?: string;
  readonly maxContextSize?: number;
  readonly maxOutputSize?: number;
  readonly capabilities?: readonly string[];
}

export interface ImportProvider {
  readonly id: string;
  readonly protocol: ImportProtocol;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly models: readonly ImportModel[];
  readonly defaultModel?: string;
}

export interface ImportReport {
  readonly source: ImportSourceName;
  readonly homeDir: string;
  readonly providers: readonly ImportProvider[];
  readonly defaultModel?: string;
}

export type ImportSourceName = 'omp' | 'kimi-code' | 'pi' | 'zcode';

export interface ImportOptions {
  /** Root to search for the source CLI's config dir (default: os homedir). */
  readonly homeDir?: string;
  readonly readFile?: (path: string) => string | undefined;
  readonly exists?: (path: string) => boolean;
  readonly joinPath?: (...parts: string[]) => string;
}

export interface ImportSourceAdapter {
  readonly name: ImportSourceName;
  readonly configDirName: string;
  isAvailable(options: ImportOptions): boolean;
  read(options: ImportOptions): ImportReport | undefined;
}
