import {
  applyCatalogProvider,
  catalogProviderModels,
  CatalogFetchError,
  RegistryImportError,
  type ImportCustomRegistryResult,
  DEFAULT_CATALOG_URL,
  resolveCatalogImport,
  type Catalog,
  type RefreshProviderModelsResponse,
  type ThinkingEffort,
} from '@zimi-ai/zimi-code-sdk';

import { createZimiCodeUserAgent } from '#/cli/host-identity';
import { fetchCatalogOrBuiltIn } from '#/utils/catalog-fetch';
import { refreshZimiRegion } from '#/utils/region';
import {
  DISCOVERY_DEFAULT_CONTEXT_SIZE,
  discoverProviderModels,
  type DiscoveredModel,
} from '@zimi-ai/agent-core-v2/app/importConfig/discovery';
import { ChoicePickerComponent } from '../components/dialogs/choice-picker';
import {
  CustomRegistryImportDialogComponent,
  type CustomRegistryImportResult,
  type CustomRegistryImportValue,
} from '../components/dialogs/custom-registry-import';
import {
  ProviderManagerComponent,
  type ProviderManagerOptions,
} from '../components/dialogs/provider-manager';
import { TabbedModelSelectorComponent } from '../components/dialogs/tabbed-model-selector';
import { DEFAULT_OAUTH_PROVIDER_NAME } from '../constant/zimi-tui';
import { formatErrorMessage } from '../utils/event-payload';
import { thinkingEffortToConfig } from '../utils/thinking-config';
import { effectiveModelForHost } from '../utils/model-switch';
import {
  promptApiKey,
  promptBaseUrl,
  promptCatalogProviderSelection,
  promptText,
} from './prompts';
import type { SlashCommandHost } from './dispatch';
import type { ZimiConfig } from '@zimi-ai/zimi-code-sdk';

// ---------------------------------------------------------------------------
// /provider command
// ---------------------------------------------------------------------------

export async function handleProviderCommand(host: SlashCommandHost, rawArgs = ''): Promise<void> {
  const args = rawArgs.trim().split(/\s+/).filter((part) => part.length > 0);
  if (args[0] === 'refresh') {
    if (args.length > 2) {
      host.showError('Usage: /provider [refresh [providerId]]');
      return;
    }
    await handleProviderRefresh(host, args[1]);
    return;
  }
  if (args.length > 0) {
    host.showError('Usage: /provider [refresh [providerId]]');
    return;
  }
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

async function handleProviderRefresh(
  host: SlashCommandHost,
  providerId: string | undefined,
): Promise<void> {
  const spinner = host.showProgressSpinner(
    providerId === undefined
      ? 'Refreshing models for all providers…'
      : `Refreshing models for ${providerId}…`,
  );
  let result: RefreshProviderModelsResponse;
  try {
    result = await host.authFlow.refreshProviderModels(
      providerId === undefined ? undefined : { providerId },
    );
  } catch (error) {
    spinner.stop({ ok: false, label: 'Refresh failed.' });
    host.showError(`Failed to refresh models: ${formatErrorMessage(error)}`);
    return;
  }
  spinner.stop({ ok: true, label: 'Refresh finished.' });
  reportProviderRefresh(host, result);
  if (result.retired_default !== undefined) {
    await host.modelMigration.retire(result.retired_default);
  }
}

function reportProviderRefresh(
  host: SlashCommandHost,
  result: RefreshProviderModelsResponse,
): void {
  for (const change of result.changed) {
    if (change.added === 0 && change.removed === 0) {
      // Metadata-only refresh: display name, capabilities, or upgrade info changed.
      host.showStatus(`${change.provider_name}: model metadata updated.`);
      continue;
    }
    const parts: string[] = [];
    if (change.added > 0) parts.push(`+${change.added}`);
    if (change.removed > 0) parts.push(`-${change.removed}`);
    // A removed alias can break agents bound to it on their next turn, so
    // removals surface as a warning rather than a plain status.
    const total = change.added + change.removed;
    host.showStatus(
      `${change.provider_name}: ${parts.join(' / ')} model${total === 1 ? '' : 's'}.`,
      change.removed > 0 ? 'warning' : undefined,
    );
  }
  for (const failure of result.failed) {
    host.showStatus(`Skipped refreshing ${failure.provider}: ${failure.reason}`, 'warning');
  }
  if (result.changed.length === 0 && result.failed.length === 0) {
    const count = result.unchanged.length;
    host.showStatus(
      `No model changes (${count} provider${count === 1 ? '' : 's'} up to date).`,
    );
  }
}

function buildProviderManagerOptions(host: SlashCommandHost): ProviderManagerOptions {
  const activeProviderId =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  return {
    providers: host.state.appState.availableProviders,
    activeProviderId,
    onAdd: () => {
      void handleProviderAdd(host).catch((error: unknown) => {
        host.showError(`Add provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onDeleteSource: (providerIds) => {
      void handleProviderManagerDeleteSource(host, providerIds).catch((error: unknown) => {
        host.showError(`Remove provider failed: ${formatErrorMessage(error)}`);
      });
    },
    onClose: () => {
      host.restoreEditor();
    },
  };
}

async function handleProviderManagerDeleteSource(
  host: SlashCommandHost,
  providerIds: readonly string[],
): Promise<void> {
  for (const providerId of providerIds) {
    try {
      await handleProviderDelete(host, providerId);
    } catch (error) {
      const msg = formatErrorMessage(error);
      host.showError(`Failed to delete provider ${providerId}: ${msg}`);
    }
  }
  reopenProviderManager(host);
}

async function handleProviderDelete(host: SlashCommandHost, providerId: string): Promise<void> {
  if (providerId === DEFAULT_OAUTH_PROVIDER_NAME) {
    await host.harness.auth.logout(DEFAULT_OAUTH_PROVIDER_NAME);
    // Drop the process-wide region cache with the credential: derived
    // endpoints (updates, marketplace, site links, telemetry) must fall back
    // to the marker/default profile, not the logged-out region.
    refreshZimiRegion();
    await host.authFlow.refreshConfigAfterLogout();
    return;
  }

  const activeProvider =
    host.state.appState.availableModels[host.state.appState.model]?.provider;
  const config = await host.harness.removeProvider(providerId);
  if (activeProvider === providerId) {
    await host.authFlow.refreshConfigAfterLogout();
  } else {
    host.setAppState({
      availableProviders: config.providers ?? {},
      availableModels: config.models ?? {},
    });
  }
}

async function handleProviderAdd(host: SlashCommandHost): Promise<void> {
  const source = await promptProviderAddSource(host);
  if (source === undefined) {
    reopenProviderManager(host);
    return;
  }

  if (source === 'known') {
    await handleCatalogProviderAdd(host);
    return;
  }
  if (source === 'manual') {
    const handled = await handleManualCustomProviderAdd(host);
    if (!handled) {
      reopenProviderManager(host);
    }
    return;
  }
  const handled = await handleCustomRegistryAddViaDialog(host);
  if (!handled) {
    reopenProviderManager(host);
  }
}

// ---------------------------------------------------------------------------
// Manual custom endpoint: ask for id / URL / key / type, auto-discover models,
// and fall back to manual model-name entry for token-bundle gateways. Same
// semantics as `zimi provider add-custom` (CLI), interactive edition.
// ---------------------------------------------------------------------------

const MANUAL_PROVIDER_TYPES = [
  { value: 'openai', label: 'openai', description: 'OpenAI-compatible /v1/chat/completions' },
  { value: 'anthropic', label: 'anthropic', description: 'Anthropic Messages API' },
  { value: 'openai_responses', label: 'openai_responses', description: 'OpenAI Responses API' },
  { value: 'google-genai', label: 'google-genai', description: 'Google Generative AI' },
  { value: 'vertexai', label: 'vertexai', description: 'Vertex AI' },
] as const;

async function handleManualCustomProviderAdd(host: SlashCommandHost): Promise<boolean> {
  const providerId = await promptText(host, {
    title: 'Provider id',
    subtitleLines: [
      'A short local name, e.g. "mygw". Models will be "<id>/<model>".',
      'Lowercase letters, digits and dashes.',
    ],
    emptyHint: 'Provider id cannot be empty.',
  });
  if (providerId === undefined) return false;
  const trimmedId = providerId.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(trimmedId)) {
    host.showError(`Invalid provider id "${trimmedId}" — use lowercase letters, digits and dashes.`);
    return false;
  }
  const existing = await host.harness.getConfig();
  if (existing.providers[trimmedId] !== undefined) {
    host.showError(
      `Provider "${trimmedId}" already exists. Delete it first or pick another id.`,
    );
    return false;
  }

  const baseUrl = await promptText(host, {
    title: `Base URL for ${trimmedId}`,
    subtitleLines: ['e.g. https://api.example.com/v1 — the /models listing is probed under it.'],
    emptyHint: 'Base URL cannot be empty.',
  });
  if (baseUrl === undefined) return false;
  const trimmedUrl = baseUrl.trim();

  const apiKey = await promptApiKey(host, trimmedId, [
    'Your key will be saved to ~/.zimi-code/config.toml',
    'Esc cancels without saving anything.',
  ]);
  if (apiKey === undefined) return false;

  const providerType = await promptChoice(host, 'Wire protocol', MANUAL_PROVIDER_TYPES, 'openai');
  if (providerType === undefined) return false;

  // Path A (the norm): probe the provider's own listing endpoint.
  const spinner = host.showLoginProgressSpinner(`Discovering models from ${trimmedUrl}…`);
  let discovered: DiscoveredModel[] = [];
  try {
    discovered = await discoverProviderModels(
      [{ id: trimmedId, type: providerType, baseUrl: trimmedUrl, apiKey }],
      { timeoutMs: 10000 },
    );
  } finally {
    spinner.stop({
      ok: discovered.length > 0,
      label:
        discovered.length > 0
          ? `Discovered ${String(discovered.length)} model(s).`
          : 'No models discovered.',
    });
  }

  let modelIds: readonly DiscoveredModel[] = discovered;

  // Path B (token-bundle gateways with no listing): declare names by hand.
  if (modelIds.length === 0) {
    host.showStatus(
      `Could not list models from ${trimmedUrl}. If this is a token-bundle gateway, enter model names manually.`,
      'warning',
    );
    const manual: string[] = [];
    for (;;) {
      const entered = await promptText(host, {
        title: manual.length === 0 ? 'Model name (required)' : `Model name #${String(manual.length + 1)} (empty to finish)`,
        subtitleLines: ['Exact model id the gateway expects, e.g. gpt-4o'],
        emptyHint: 'At least one model name is required.',
        allowEmpty: manual.length > 0,
      });
      if (entered === undefined) {
        if (manual.length === 0) return false; // Esc with nothing entered: cancel
        break;
      }
      const name = entered.trim();
      if (name.length === 0) {
        if (manual.length === 0) continue; // emptyHint already shown
        break;
      }
      if (!manual.includes(name)) manual.push(name);
    }
    modelIds = manual.map((modelId) => ({ providerId: trimmedId, modelId, contextWindow: undefined }));
  }

  const providerPatch = {
    type: providerType,
    baseUrl: trimmedUrl,
    apiKey,
    source: { added: 'tui-manual' },
  } as unknown as ZimiConfig['providers'][string];

  const modelsPatch: Record<string, { provider: string; model: string; maxContextSize: number }> = {};
  for (const { modelId, contextWindow } of modelIds) {
    modelsPatch[`${trimmedId}/${modelId}`] = {
      provider: trimmedId,
      model: modelId,
      maxContextSize: contextWindow ?? DISCOVERY_DEFAULT_CONTEXT_SIZE,
    };
  }

  await host.harness.setConfig({
    providers: { [trimmedId]: providerPatch } as ZimiConfig['providers'],
    models: modelsPatch as ZimiConfig['models'],
  });
  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: trimmedId, method: 'manual-custom' });
  host.showStatus(
    `Provider added: ${trimmedId} (${providerType}, ${String(modelIds.length)} model(s)).`,
    'success',
  );

  // Same convenience tail as the catalog flow: pick a default model.
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(stateModels).find((a) => a.startsWith(`${trimmedId}/`)),
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: trimmedId,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
  return true;
}

function promptChoice<T extends string>(
  host: SlashCommandHost,
  title: string,
  options: readonly { value: T; label: string; description?: string }[],
  _default: T,
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title,
      options: options.map((option) => ({
        value: option.value,
        label: option.label,
        description: option.description,
      })),
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value as T);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

function reopenProviderManager(host: SlashCommandHost): void {
  const options = buildProviderManagerOptions(host);
  const component = new ProviderManagerComponent(options);
  host.mountEditorReplacement(component);
}

function promptProviderAddSource(
  host: SlashCommandHost,
): Promise<'known' | 'custom' | 'manual' | undefined> {
  return new Promise((resolve) => {
    const picker = new ChoicePickerComponent({
      title: 'Add provider',
      options: [
        { value: 'known', label: 'Known third-party provider' },
        {
          value: 'manual',
          label: 'Custom endpoint (URL + API key)',
          description: 'Models are auto-discovered; token-bundle gateways can declare them by hand.',
        },
        { value: 'custom', label: 'Custom registry (api.json)' },
      ],
      onSelect: (value) => {
        host.restoreEditor();
        resolve(value === 'known' || value === 'custom' || value === 'manual' ? value : undefined);
      },
      onCancel: () => {
        host.restoreEditor();
        resolve(undefined);
      },
    });
    host.mountEditorReplacement(picker);
  });
}

async function handleCatalogProviderAdd(host: SlashCommandHost): Promise<void> {
  const controller = new AbortController();
  const cancel = (): void => {
    controller.abort();
  };
  host.cancelInFlight = cancel;

  const spinner = host.showLoginProgressSpinner(`Fetching catalog from ${DEFAULT_CATALOG_URL}`);
  let catalog: Catalog | undefined;
  try {
    const loaded = await fetchCatalogOrBuiltIn(DEFAULT_CATALOG_URL, {
      signal: controller.signal,
      userAgent: createZimiCodeUserAgent(),
    });
    catalog = loaded.catalog;
    spinner.stop({
      ok: true,
      label: loaded.fromBuiltIn
        ? 'Catalog loaded from built-in snapshot (models.dev unreachable).'
        : 'Catalog loaded.',
    });
  } catch (error) {
    if (controller.signal.aborted) {
      spinner.stop({ ok: false, label: 'Aborted.' });
    } else {
      const hint = error instanceof CatalogFetchError ? ` (HTTP ${error.status})` : '';
      spinner.stop({ ok: false, label: 'Failed to load catalog.' });
      host.showError(`Failed to fetch catalog${hint}: ${formatErrorMessage(error)}`);
    }
  } finally {
    if (host.cancelInFlight === cancel) host.cancelInFlight = undefined;
  }

  if (catalog === undefined) return;

  const providerId = await promptCatalogProviderSelection(host, catalog);
  if (providerId === undefined) return;
  const entry = catalog[providerId];
  if (entry === undefined) return;

  const models = catalogProviderModels(entry);
  if (models.length === 0) {
    host.showError(`Provider "${providerId}" has no usable models in this catalog.`);
    return;
  }

  let resolution = resolveCatalogImport(entry);
  if (resolution.kind === 'needs-base-url') {
    const entered = await promptBaseUrl(host, entry.name ?? providerId);
    if (entered === undefined) return;
    resolution = resolveCatalogImport(entry, entered);
  }
  if (resolution.kind !== 'ok') {
    if (resolution.kind === 'invalid') {
      if (resolution.reason === 'unknown-explicit-type') {
        host.showError(
          `Provider "${providerId}" declares protocol "${entry.type}" in the catalog, which this client version does not support.`,
        );
      } else if (resolution.reason === 'proprietary-sdk') {
        host.showError(
          `Provider "${providerId}" uses a proprietary SDK this client cannot speak (e.g. Amazon Bedrock or Cohere); it cannot be imported from the catalog.`,
        );
      } else {
        host.showError(
          `Base URL contains an env placeholder or is empty. Enter the resolved URL instead.`,
        );
      }
    }
    return;
  }
  const { wire, baseUrl } = resolution;

  const apiKey = await promptApiKey(host, entry.name ?? providerId);
  if (apiKey === undefined) return;

  // Persist the provider and all its models immediately after the api key is
  // entered. The model selector that follows is just a convenience to pick the
  // default model; ESC leaves the provider in place without a default selection.
  const existingConfig = await host.harness.getConfig();
  if (existingConfig.providers[providerId] !== undefined) {
    await host.harness.removeProvider(providerId);
  }

  const config = await host.harness.getConfig();
  applyCatalogProvider(config, {
    providerId,
    wire,
    baseUrl,
    apiKey,
    models,
    selectedModelId: '', // no default yet; user picks in the model selector
    thinking: false,    // will be resolved by the model selector
  });

  await host.harness.setConfig({
    providers: config.providers,
    models: config.models,
  });

  await host.authFlow.refreshConfigAfterLogin();
  host.track('connect', { provider: providerId, method: 'catalog' });
  host.showStatus(`Provider added: ${entry.name ?? providerId}`);
  if (resolution.guessed) {
    host.showStatus(
      `Protocol guessed as "openai" for ${providerId} — edit "type" in config.toml if requests fail.`,
    );
  }

  // The config's model table already holds the newly-persisted provider's
  // models next to the existing ones, so the tabbed selector shows every
  // provider's tab (the new provider's tab starts active via initialTabId).
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: Object.keys(stateModels).find((a) => a.startsWith(`${providerId}/`)),
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: providerId,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
}

export async function setDefaultModel(
  host: SlashCommandHost,
  alias: string,
  effort: ThinkingEffort,
): Promise<void> {
  // Resolve efforts the same way the /model path does (effectiveModelForHost
  // applies overrides and the protocol-profile inference): catalog entries for
  // e.g. Anthropic models declare no support_efforts on the alias, and without
  // the inference an above-default pick would slip through as a persisted effort.
  const model = host.state.appState.availableModels[alias];
  const thinking = thinkingEffortToConfig(
    effort,
    model === undefined ? undefined : effectiveModelForHost(host, model),
  );
  if (host.session === undefined) {
    // A first prompt may still be inside lazy creation: wait it out so the
    // pick lands on the new session instead of racing its assembly (same
    // coordination as the /model path).
    await host.waitForSessionAssembly();
  }
  await host.harness.setConfig({
    defaultModel: alias,
    thinking,
  });
  // Whether activation made the engine emit model_switch (it reached a live
  // session AND changed the bound alias — both engines track only an actual
  // change). Recorded at activation time rather than snapshotted at entry: a
  // lazy session can come live while the config writes above are pending; a
  // session created BY activation (v1) or a same-alias rebind does not count
  // — both bind the model without an engine event.
  const refreshed = await host.authFlow.refreshConfigAfterLogin(effort);
  // A mounted confirmation gate owns the whole switch — including the picked
  // effort — so the follow-up activation must not fire under the open dialog.
  const gateOwnsSwitch = refreshed === 'gated';
  let engineTrackedSwitch = refreshed === 'gated' ? true : refreshed;
  // refreshConfigAfterLogin reactivates from the persisted config, so a pick
  // the gate keeps session-only never reaches the runtime — apply it after
  // the refresh, or the persisted value would clobber it.
  if (!gateOwnsSwitch && thinking.effort === undefined && effort !== 'off' && effort !== 'on') {
    engineTrackedSwitch =
      (await host.authFlow.activateModelAfterLogin(alias, effort)) || engineTrackedSwitch;
  }
  // When the engine never emitted (no live session, or the alias was already
  // bound), the TUI stays the sole producer for the pick.
  if (!engineTrackedSwitch) {
    host.track('model_switch', { model: alias });
  }
  host.showStatus(`Default model set to ${alias} with thinking ${effort}.`);
}

async function handleCustomRegistryAddViaDialog(host: SlashCommandHost): Promise<boolean> {
  const value = await promptCustomRegistryImport(host);
  if (value === undefined) return false;

  let result: ImportCustomRegistryResult;
  try {
    result = await host.harness.importCustomRegistry({
      url: value.url,
      apiKey: value.apiKey,
      setDefaultWhenUnset: false,
    });
  } catch (error) {
    if (error instanceof RegistryImportError && error.phase === 'empty') {
      host.showStatus('Registry contained no providers.');
      return false;
    }
    const phase =
      error instanceof RegistryImportError && error.phase === 'fetch' ? 'import' : 'apply';
    host.showError(`Failed to ${phase} registry: ${formatErrorMessage(error)}`);
    if (
      value.apiKey === undefined &&
      error instanceof RegistryImportError &&
      (error.status === 401 || error.status === 403)
    ) {
      host.showStatus('This registry requires authentication — paste its Bearer token.', 'warning');
    }
    return false;
  }
  try {
    await host.authFlow.refreshConfigAfterLogin();
  } catch (error) {
    host.showError(`Failed to apply registry: ${formatErrorMessage(error)}`);
    return false;
  }
  const addedProviderIds = result.providers.map((provider) => provider.id);
  const count = addedProviderIds.length;
  host.showStatus(
    count === 1
      ? 'Imported 1 provider from registry.'
      : `Imported ${String(count)} providers from registry.`,
    'success',
  );
  for (const [id, envName] of Object.entries(result.credentialEnv)) {
    host.showStatus(
      `provider "${id}" declares credential env var "${envName}" — set api_key_env in config.toml to use it`,
    );
  }

  // Offer the model selector so the user can pick a default, just like the
  // catalog (known-provider) flow.
  const stateModels = await host.harness.getConfig().then((c) => c.models ?? {});
  const firstNewAlias = Object.keys(stateModels).find((a) =>
    addedProviderIds.some((pid) => a.startsWith(`${pid}/`)),
  );
  const firstNewProvider = firstNewAlias
    ? stateModels[firstNewAlias]?.provider
    : addedProviderIds[0];
  const selector = new TabbedModelSelectorComponent({
    models: stateModels,
    currentValue: host.state.appState.model,
    selectedValue: firstNewAlias,
    currentThinkingEffort: host.state.appState.thinkingEffort,
    initialTabId: firstNewProvider,
    onSelect: ({ alias, thinking }) => {
      host.restoreEditor();
      void setDefaultModel(host, alias, thinking).catch((error: unknown) => {
        host.showError(`Set default model failed: ${formatErrorMessage(error)}`);
      });
    },
    onCancel: () => {
      host.restoreEditor();
    },
  });
  host.mountEditorReplacement(selector);
  return true;
}

function promptCustomRegistryImport(
  host: SlashCommandHost,
): Promise<CustomRegistryImportValue | undefined> {
  return new Promise((resolve) => {
    const dialog = new CustomRegistryImportDialogComponent(
      (result: CustomRegistryImportResult) => {
        host.restoreEditor();
        resolve(result.kind === 'ok' ? result.value : undefined);
      },
    );
    host.mountEditorReplacement(dialog);
  });
}
