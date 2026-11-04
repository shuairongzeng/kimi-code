import * as vscode from "vscode";

import {
  createZimiRegionResolver,
  ZIMI_CODE_PROVIDER_NAME,
  type ZimiRegionAuthRead,
  type ZimiRegionResolution,
  type ZimiRegionResolver,
} from "@zimi-ai/zimi-code-oauth";
import { loadRuntimeConfigSafe, resolveConfigPath } from "@zimi-ai/zimi-code-sdk";

export interface ExtensionRegionOptions {
  readonly homeDir: string;
  readonly refresh?: boolean;
}

export function readPersistedZimiOAuthRef(
  homeDir: string,
): { readonly key: string; readonly oauthHost?: string } | undefined {
  return loadRuntimeConfigSafe(resolveConfigPath({ homeDir })).config.providers?.[
    ZIMI_CODE_PROVIDER_NAME
  ]?.oauth;
}

function readAuth(homeDir: string): ZimiRegionAuthRead {
  try {
    const result = loadRuntimeConfigSafe(resolveConfigPath({ homeDir }));
    if (result.fileError !== undefined) return { status: "unreadable" };
    const ref = result.config.providers?.[ZIMI_CODE_PROVIDER_NAME]?.oauth;
    return ref === undefined ? { status: "logged-out" } : { status: "logged-in", ref };
  } catch {
    return { status: "unreadable" };
  }
}

const resolvers = new Map<string, ZimiRegionResolver>();

export function resolveExtensionRegion(options: ExtensionRegionOptions): ZimiRegionResolution {
  let resolver = resolvers.get(options.homeDir);
  if (resolver === undefined) {
    resolver = createZimiRegionResolver({
      homeDir: options.homeDir,
      readAuth: () => readAuth(options.homeDir),
      authFilePath: resolveConfigPath({ homeDir: options.homeDir }),
      readMarker: process.env["ZIMI_CODE_REGION_MARKER"] !== "off",
      allowLocalInference: vscode.env.remoteName === undefined,
    });
    resolvers.set(options.homeDir, resolver);
  }
  return options.refresh === true ? resolver.refresh() : resolver.current();
}

export function resetExtensionRegionCache(): void {
  resolvers.clear();
}
