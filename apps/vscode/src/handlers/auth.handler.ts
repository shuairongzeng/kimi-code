import * as vscode from "vscode";

import {
  ZIMI_CODE_OAUTH_KEY,
  ZIMI_REGION_PROFILES,
  zimiRegionProfile,
  OAuthAccessDeniedError,
  type ZimiRegion,
} from "@zimi-ai/zimi-code-oauth";
import { resolveZimiHome } from "@zimi-ai/zimi-code-sdk";

import { Events, Methods } from "../../shared/bridge";
import type { LoginResult } from "../../shared/legacy-sdk";
import type { LoginStatus } from "../../shared/types";
import { updateLoginContext } from "../utils/context";
import { readPersistedZimiOAuthRef, resolveExtensionRegion } from "../utils/region";
import type { Handler } from "./types";

function regionForLogin(): ZimiRegion | undefined {
  const homeDir = resolveZimiHome();
  const oauth = readPersistedZimiOAuthRef(homeDir);
  if (oauth !== undefined) {
    if (oauth.key === ZIMI_CODE_OAUTH_KEY) return "mainland-cn";
    if (
      oauth.oauthHost !== undefined &&
      oauth.oauthHost.replace(/\/+$/, "") === ZIMI_REGION_PROFILES.global.oauthHost
    ) {
      return "global";
    }
    return undefined;
  }
  return resolveExtensionRegion({ homeDir, refresh: true }).region;
}

export const authHandlers: Record<string, Handler<any, any>> = {
  [Methods.CheckLoginStatus]: async (_, ctx): Promise<LoginStatus> => {
    const region = regionForLogin() ?? "mainland-cn";
    return {
      loggedIn: await updateLoginContext(ctx.harness),
      siteBase: zimiRegionProfile(region).siteBase,
    };
  },

  [Methods.Login]: async (_, ctx): Promise<LoginResult> => {
    try {
      await ctx.harness.auth.login(undefined, {
        region: regionForLogin(),
        onDeviceCode: async (authorization) => {
          const url = authorization.verificationUriComplete || authorization.verificationUri;
          ctx.broadcast(Events.LoginUrl, { url }, ctx.webviewId);
          await vscode.env.openExternal(vscode.Uri.parse(url));
        },
      });
      await updateLoginContext(ctx.harness);
      resolveExtensionRegion({ homeDir: resolveZimiHome(), refresh: true });
      return { success: true };
    } catch (error) {
      ctx.logError("Zimi login failed", error);
      await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
        ctx.logError("Unable to refresh login status after a failed login", statusError);
      });
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: error instanceof OAuthAccessDeniedError ? `Login cancelled: ${message}` : message,
      };
    }
  },

  [Methods.Logout]: async (_, ctx): Promise<LoginResult> => {
    try {
      await ctx.harness.auth.logout();
      await updateLoginContext(ctx.harness);
      resolveExtensionRegion({ homeDir: resolveZimiHome(), refresh: true });
      return { success: true };
    } catch (error) {
      ctx.logError("Zimi logout failed", error);
      await updateLoginContext(ctx.harness).catch((statusError: unknown) => {
        ctx.logError("Unable to refresh login status after a failed logout", statusError);
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
