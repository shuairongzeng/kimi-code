export const WS_BEARER_PROTOCOL_PREFIX = 'zimi-code.bearer.';
// The shipped web bundle is a frozen prebuilt artifact that still sends the
// upstream `kimi-code.bearer.` subprotocol. Accept it as a legacy alias so the
// desktop/web client can authenticate; the canonical prefix stays zimi-code.
export const LEGACY_WS_BEARER_PROTOCOL_PREFIX = 'kimi-code.bearer.';

const WS_BEARER_PROTOCOL_PREFIXES = [
  WS_BEARER_PROTOCOL_PREFIX,
  LEGACY_WS_BEARER_PROTOCOL_PREFIX,
] as const;

export function extractWsBearerToken(protocolHeader: string | undefined): string | null {
  if (protocolHeader === undefined) {
    return null;
  }
  for (const entry of protocolHeader.split(',')) {
    const protocol = entry.trim();
    for (const prefix of WS_BEARER_PROTOCOL_PREFIXES) {
      if (protocol.startsWith(prefix)) {
        const token = protocol.slice(prefix.length);
        return token.length === 0 ? null : token;
      }
    }
  }
  return null;
}

export function selectWsBearerProtocol(protocols: Iterable<string>): string | false {
  for (const protocol of protocols) {
    if (WS_BEARER_PROTOCOL_PREFIXES.some((prefix) => protocol.startsWith(prefix))) {
      return protocol;
    }
  }
  return false;
}
