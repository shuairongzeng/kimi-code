import * as vscode from "vscode";
import type { ZimiHarness } from "@zimi-ai/zimi-code-sdk";

export async function updateLoginContext(harness: ZimiHarness): Promise<boolean> {
  const status = await harness.auth.status();
  const loggedIn = status.providers.some((provider) => provider.hasToken);
  await vscode.commands.executeCommand("setContext", "zimi.isLoggedIn", loggedIn);
  return loggedIn;
}
