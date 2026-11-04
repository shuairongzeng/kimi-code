import type { ZimiHarnessEnvironmentOptions } from '#/zimi-harness';
export { ZimiHarness } from '#/zimi-harness';
export type { ZimiHarnessEnvironmentOptions, ZimiHarnessRuntimeOptions } from '#/zimi-harness';
export { Session } from '#/session';
export { ZimiAuthFacade } from '#/auth';
export {
  createZimiHarness,
  SDKRpcClientV2,
  type SDKRpcClientV2Options,
} from '#/sdk-rpc-client-v2';
export {
  createZimiConfigRpc,
  ZimiConfigRpcClient,
  type ZimiConfigRpc,
  type ZimiConfigValidationIssue,
  type ZimiConfigValidationPathSegment,
  type ResolveZimiConfigPathInput,
  type ValidateZimiConfigTomlInput,
} from '#/config-rpc';
export { SDKRpcClientBase } from '#/rpc';
export type { ConfigSectionChange } from '#/rpc';
export { ZimiForCodingProvider } from '#/zimi-code-model-provider';
export type { ZimiForCodingProviderOptions } from '#/zimi-code-model-provider';

export {
  applyCatalogProvider,
  catalogBaseUrl,
  catalogModelToAlias,
  catalogProviderModels,
  CatalogFetchError,
  RegistryImportError,
  DEFAULT_CATALOG_URL,
  fetchCatalog,
  inferWireType,
  loadBuiltInCatalog,
  resolveCatalogImport,
} from '#/catalog';
export type {
  ApplyCatalogProviderOptions,
  Catalog,
  CatalogImportInvalidReason,
  CatalogImportResolution,
  CatalogModel,
  CatalogProviderEntry,
  FetchCatalogOptions,
} from '#/catalog';

export {
  ErrorCodes,
  ZimiError,
  type ZimiErrorCode,
  type ZimiErrorInfo,
  type ZimiErrorOptions,
  type ZimiErrorPayload,
  ZIMI_ERROR_INFO,
  fromZimiErrorPayload,
  isZimiError,
  toZimiErrorPayload,
} from '#/errors';

export {
  flushDiagnosticLogs,
  flushDiagnosticLogsSync,
  log,
  redact,
  resolveGlobalLogPath,
} from '#/logging/index';
export {
  computeUpdateStatus,
  isMissingMarketplaceTokenError,
  isTrustedPluginMarketplaceUrl,
  ZIMI_CODE_PLUGIN_MARKETPLACE_URL_ENV,
  parsePluginMarketplace,
  marketplaceEntryInstallableOnHost,
  marketplaceEntrySupportsClient,
  marketplaceEntryVisibleOnHost,
  pluginClientForIdentity,
  PLUGIN_MARKETPLACE_CLASSIFICATIONS,
  PLUGIN_MARKETPLACE_CLIENTS,
  PLUGIN_MARKETPLACE_TIERS,
  readPluginMarketplace,
  withLatestVersions,
} from '@zimi-ai/agent-core-v2/app/plugin/marketplace';
export { PluginAvailabilityStore } from '@zimi-ai/agent-core-v2/app/plugin/availability';
export { resolveZimiHome } from '@zimi-ai/agent-core-v2';
export type { LogContext, LogLevel, LogPayload, Logger } from '#/logging/index';

export { effectiveModelAlias, loadRuntimeConfigSafe } from '#/config/index';
export { resolveConfigPath } from '@zimi-ai/agent-core-v2';
export { limitAgentReplayByTurns } from '#/replay';
export { parseAgentFileText, resolveAgentPath } from '@zimi-ai/agent-core-v2';
export { SECONDARY_DERIVED_MODEL_ALIAS } from '#/config/index';
export { PRIMARY_SUBAGENT_MODEL_CHOICE } from '@zimi-ai/agent-core-v2/session/subagent/configSection';

export { installGlobalProxyDispatcher } from '#/proxy';

export {
  buildImageCompressionCaption,
  buildUnsupportedImageNotice,
  gateImageFormatParts,
  isModelAcceptedImageMime,
  normalizeImageMime,
  parseImageDataUrl,
  persistOriginalImage,
  sessionMediaOriginalsDir,
  IMAGE_BYTE_BUDGET,
  MAX_IMAGE_EDGE_PX,
} from '@zimi-ai/agent-core-v2';
export { compressBase64ForModel, compressImageForModel, ImageLimits } from '#/image';
export type {
  CompressImageOptions,
  CompressImageResult,
  CompressBase64Result,
  ImageCompressionCaptionInput,
  ImageCompressionTelemetry,
} from '#/image';

export type {
  ExperimentalFeatureState,
  ExperimentalFlagMap,
  ExperimentalFlagSource,
  FlagDefinition,
  FlagDefinitionInput,
  FlagId,
  FlagSurface,
} from '#/flag';

export {
  buildDaemonFileUrl,
  buildMediaPathTag,
  isDaemonFileUrl,
  matchSingleMediaPathTag,
  parseDaemonFileUrl,
} from '@zimi-ai/agent-core-v2/agent/media/mediaRef';
export type {
  DaemonFileRef,
  MediaKind,
} from '@zimi-ai/agent-core-v2/agent/media/mediaRef';

export type {
  ZimiAuthCompleteFeedbackUploadInput,
  ZimiAuthCompleteFeedbackUploadPart,
  ZimiAuthCreateFeedbackUploadUrlInput,
  ZimiAuthCreateFeedbackUploadUrlOk,
  ZimiAuthCreateFeedbackUploadUrlResult,
  ZimiAuthFeedbackUploadPart,
  ZimiAuthLoginResult,
  ZimiAuthLogoutResult,
  ZimiAuthSubmitFeedbackInput,
} from '#/auth';

export * from '#/events';
export type * from '#/types';
