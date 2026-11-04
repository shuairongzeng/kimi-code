export {
  DeviceCodeExpiredError,
  DeviceCodeTimeoutError,
  OAuthAccessDeniedError,
  OAuthConnectionError,
  OAuthError,
  OAuthUnauthorizedError,
  RetryableRefreshError,
} from './errors';

export type {
  DeviceAuthorization,
  DeviceHeaders,
  OAuthFlowConfig,
  OAuthStorageBackend,
  TokenInfo,
  TokenInfoWire,
} from './types';
export { tokenFromWire, tokenToWire } from './types';

export type { TokenStorage } from './storage';
export { FileTokenStorage } from './storage';

export type { DevicePollResult, RefreshOptions } from './oauth';
export { pollDeviceToken, refreshAccessToken, requestDeviceAuthorization } from './oauth';

export type { LoginOptions, OAuthManagerOptions, OAuthRefreshOutcome } from './oauth-manager';
export { OAuthManager, defaultRefreshThreshold, newInstanceId } from './oauth-manager';

export {
  assertZimiHostIdentity,
  createZimiDefaultHeaders,
  createZimiDeviceHeaders,
  createZimiDeviceId,
  createZimiUserAgent,
  ZIMI_CODE_CUSTOM_HEADERS_ENV,
  ZIMI_CODE_PLATFORM,
  parseZimiCodeCustomHeaders,
  readZimiDeviceId,
  replaceUserAgentProduct,
} from './identity';
export type { ZimiHostIdentity, ZimiIdentityOptions } from './identity';

export { ZIMI_CODE_FLOW_CONFIG } from './constants';

export {
  ZIMI_REGION_MARKER_FILENAME,
  ZIMI_REGION_PROFILES,
  zimiCdnContentUrl,
  zimiRegionLoginHosts,
  zimiRegionProfile,
  zimiRegionSchema,
  readZimiRegionMarker,
  resolveZimiRegion,
  resolveZimiRegionDetailed,
  resolveZimiRegionFromParts,
  resolveZimiRemoteControlAuth,
} from './region';
export type {
  ZimiRegion,
  ZimiRegionProfile,
  ZimiRegionResolution,
  ZimiRegionSource,
  ZimiRemoteControlAuth,
  ResolveZimiRegionOptions,
  ResolveZimiRegionParts,
} from './region';

export { createZimiRegionResolver, decideZimiRegion } from './region-resolver';
export type {
  CreateZimiRegionResolverOptions,
  ZimiRegionAuthRead,
  ZimiRegionAuthSnapshot,
  ZimiRegionCacheAction,
  ZimiRegionDecideInput,
  ZimiRegionDecision,
  ZimiRegionResolver,
} from './region-resolver';

export { collectLocalRegionSignals, detectZimiRegionFromLocalSignals } from './region-local';
export type { LocalRegionDetection, LocalRegionSignals } from './region-local';

export {
  applyManagedApiKeyProviderModels,
  applyManagedZimiCodeLogoutConfig,
  applyManagedZimiCodeConfig,
  clearManagedZimiCodeConfig,
  fetchManagedZimiCodeModels,
  zimiCodeEnvBaseUrl,
  zimiCodeEnvOAuthHost,
  ZIMI_CODE_OAUTH_KEY,
  ZIMI_CODE_PLATFORM_ID,
  ZIMI_CODE_PROVIDER_NAME,
  ManagedZimiCodeModelsAuthError,
  provisionManagedZimiCodeConfig,
  resolveZimiCodeLoginAuth,
  resolveZimiCodeOAuthKey,
  resolveZimiCodeOAuthRef,
  resolveZimiCodeRuntimeAuth,
  toManagedModelAlias,
} from './managed-zimi-code';
export type {
  FetchManagedZimiCodeModelsOptions,
  ManagedZimiCodeApplyResult,
  ManagedZimiCodeCleanupResult,
  ManagedZimiCodeProtocol,
  ManagedZimiEnv,
  ManagedZimiLoginAuth,
  ManagedZimiCodeModelInfo,
  ManagedZimiCodeProvisionResult,
  ManagedZimiConfigAdapter,
  ManagedZimiConfigShape,
  ManagedZimiOAuthRef,
  ManagedZimiOAuthRefInput,
  ManagedZimiRuntimeAuth,
  ProvisionManagedZimiCodeConfigOptions,
} from './managed-zimi-code';

export {
  fetchManagedUserInfo,
  zimiCodeUserInfoUrl,
  managedUserInfoPhoneSchema,
  managedUserInfoResultSchema,
  managedUserInfoSchema,
  parseManagedUserInfoPayload,
} from './managed-userinfo';
export type {
  FetchManagedUserInfoError,
  FetchManagedUserInfoResult,
  ManagedUserInfo,
  ManagedUserInfoPhone,
  ManagedUserInfoResult,
} from './managed-userinfo';

export {
  boosterWalletInfoSchema,
  fetchManagedUsage,
  formatDuration,
  isManagedZimiCode,
  isManagedZimiCodeBaseUrl,
  zimiCodeBaseUrl,
  zimiCodeUsageUrl,
  managedQuotaEntrySchema,
  managedQuotaSchema,
  managedQuotaUsagesSchema,
  managedUsageResultSchema,
  parseManagedUsagePayload,
} from './managed-usage';
export type {
  BoosterWalletInfo,
  FetchManagedUsageError,
  FetchManagedUsageResult,
  ManagedQuota,
  ManagedQuotaEntry,
  ManagedQuotaUsages,
  ManagedUsageResult,
} from './managed-usage';

export { fetchChatTitle, zimiCodeToolsUrl } from './managed-tools';
export type {
  FetchChatTitleError,
  FetchChatTitleOk,
  FetchChatTitleResult,
} from './managed-tools';

export { fetchSubmitFeedback, zimiCodeFeedbackUrl } from './managed-feedback';
export type {
  FetchSubmitFeedbackError,
  FetchSubmitFeedbackOk,
  FetchSubmitFeedbackResult,
  SubmitFeedbackBody,
} from './managed-feedback';

export {
  fetchCompleteFeedbackUpload,
  fetchCreateFeedbackUploadUrl,
  zimiCodeFeedbackUploadCompleteUrl,
  zimiCodeFeedbackUploadUrl,
} from './managed-feedback-upload';
export type {
  CompleteFeedbackUploadBody,
  CreateFeedbackUploadUrlBody,
  CreateFeedbackUploadUrlResponse,
  FetchCompleteFeedbackUploadResult,
  FetchCreateFeedbackUploadUrlResult,
  FetchFeedbackUploadError,
} from './managed-feedback-upload';

export {
  applyOpenPlatformConfig,
  capabilitiesForModel,
  fetchOpenPlatformModels,
  filterModelsByPrefix,
  getOpenPlatformById,
  isOpenPlatformId,
  OPEN_PLATFORMS,
  OpenPlatformApiError,
  removeOpenPlatformConfig,
} from './open-platform';
export type {
  ApplyOpenPlatformResult,
  OpenPlatformDefinition,
} from './open-platform';

export {
  applyCustomRegistryEntries,
  applyCustomRegistryProvider,
  capabilitiesFromCustomEntry,
  credentialEnvHints,
  CustomRegistryApiError,
  CUSTOM_REGISTRY_DEFAULT_CAPABILITIES,
  CUSTOM_REGISTRY_DEFAULT_MAX_CONTEXT,
  customRegistryReplacementKeys,
  fetchCustomRegistry,
  removeCustomRegistryEntries,
  removeCustomRegistryProvider,
} from './custom-registry';
export type {
  CustomRegistryModelEntry,
  CustomRegistryProviderEntry,
  CustomRegistryProviderType,
  CustomRegistryRemoval,
  CustomRegistryReplacementKeys,
  CustomRegistrySource,
  FetchCustomRegistryOptions,
} from './custom-registry';

export {
  apiKeyEnvMissingMessage,
  credentialConflictMessage,
  declaredProviderCredential,
  reconcileProviderCredentialUpdate,
} from './provider-credential';
export type {
  DeclaredProviderCredential,
  ProviderCredentialReconciliation,
  ProviderCredentialUpdate,
  ProviderCredentialView,
} from './provider-credential';

export { ZimiOAuthToolkit, resolveZimiTokenStorageName } from './toolkit';
export type {
  AuthManagedUsageResult,
  AuthManagedUserInfoResult,
  AuthProviderStatus,
  AuthStatus,
  BearerTokenProvider,
  ZimiOAuthLoginOptions,
  ZimiOAuthLoginResult,
  ZimiOAuthLogoutResult,
  ZimiOAuthTokenRef,
  ZimiOAuthToolkitOptions,
} from './toolkit';

export { refreshProviderModels } from './refreshProviderModels';
export type {
  ProviderChange,
  RefreshProviderHost,
  RefreshProviderOptions,
  RefreshProviderScope,
  RefreshResult,
} from './refreshProviderModels';

export type { OAuthTokenTransactionOptions } from './oauth-token-transaction';
export { OAuthTokenTransaction } from './oauth-token-transaction';
