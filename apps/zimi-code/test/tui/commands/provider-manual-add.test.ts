/**
 * Scenario: /provider → Add → "Custom endpoint (URL + API key)" interactive
 * flow — the TUI twin of `zimi provider add-custom`.
 * Responsibilities: prompts for id/URL/key/protocol in the UI, auto-discovers
 * models via the endpoint listing, and falls back to manual model-name entry
 * for token-bundle gateways; invalid or duplicate ids are rejected without
 * touching the config.
 * Wiring: real handleProviderCommand + real dialog components driven through
 * handleInput; only the discovery probe and the harness/authFlow boundaries
 * are stubbed.
 * Run: pnpm -C apps/zimi-code exec vitest run test/tui/commands/provider-manual-add.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SlashCommandHost } from '#/tui/commands';
import { handleProviderCommand } from '#/tui/commands/provider';
import type * as DiscoveryModule from '@zimi-ai/agent-core-v2/app/importConfig/discovery';
import {
  DISCOVERY_DEFAULT_CONTEXT_SIZE,
  discoverProviderModels,
} from '@zimi-ai/agent-core-v2/app/importConfig/discovery';

vi.mock('@zimi-ai/agent-core-v2/app/importConfig/discovery', async (importOriginal) => {
  const actual = await importOriginal<typeof DiscoveryModule>();
  return { ...actual, discoverProviderModels: vi.fn() };
});

const discoverMock = vi.mocked(discoverProviderModels);

beforeEach(() => {
  discoverMock.mockReset();
});

interface Mountable {
  handleInput(data: string): void;
}

function makeRig(providers: Record<string, unknown> = {}) {
  const mounts: Mountable[] = [];
  const mountNames: string[] = [];
  const config: { providers: Record<string, unknown>; models: Record<string, unknown> } = {
    providers: { ...providers },
    models: {},
  };
  const host = {
    state: {
      appState: {
        availableModels: {},
        availableProviders: providers,
        model: 'some/model',
        thinkingEffort: 'off',
      },
    },
    harness: {
      getConfig: vi.fn(async () => config),
      setConfig: vi.fn(async (patch: { providers?: Record<string, unknown>; models?: Record<string, unknown> }) => {
        Object.assign(config.providers, patch.providers ?? {});
        Object.assign(config.models, patch.models ?? {});
        return config;
      }),
      removeProvider: vi.fn(async () => config),
    },
    authFlow: { refreshConfigAfterLogin: vi.fn(async () => false) },
    mountEditorReplacement: vi.fn((component: Mountable) => {
      mounts.push(component);
      mountNames.push(component.constructor.name);
    }),
    restoreEditor: vi.fn(),
    beginAuthBlock: vi.fn(() => vi.fn()),
    showLoginProgressSpinner: vi.fn(() => ({ stop: vi.fn() })),
    showStatus: vi.fn(),
    showError: vi.fn(),
    track: vi.fn(),
    waitForSessionAssembly: vi.fn(async () => {}),
    session: {},
  } as unknown as SlashCommandHost & {
    harness: {
      getConfig: ReturnType<typeof vi.fn>;
      setConfig: ReturnType<typeof vi.fn>;
    };
    mountEditorReplacement: ReturnType<typeof vi.fn>;
    showStatus: ReturnType<typeof vi.fn>;
    showError: ReturnType<typeof vi.fn>;
    track: ReturnType<typeof vi.fn>;
    authFlow: { refreshConfigAfterLogin: ReturnType<typeof vi.fn> };
  };
  return { host, mounts, mountNames, config };
}

/** Types `text` into a mounted ApiKeyInputDialog and submits with Enter. */
function typeInto(dialog: Mountable, text: string): void {
  dialog.handleInput(text);
  dialog.handleInput('\r');
}

/** Opens /provider, walks to the Add row, and picks "Custom endpoint". */
async function openManualFlow(rig: ReturnType<typeof makeRig>): Promise<void> {
  await handleProviderCommand(rig.host, '');
  await vi.waitFor(() => expect(rig.mounts.length).toBe(1)); // ProviderManagerComponent
  // The synthetic "[ Add New Platform ]" row is pinned last; down-arrows clamp
  // at the end regardless of how many provider rows precede it.
  for (let i = 0; i < 12; i++) rig.mounts[0]!.handleInput('\x1b[B');
  rig.mounts[0]!.handleInput('\r');
  await vi.waitFor(() => expect(rig.mounts.length).toBe(2)); // add-source ChoicePicker
  rig.mounts[1]!.handleInput('\x1b[B'); // known → manual
  rig.mounts[1]!.handleInput('\r');
  await vi.waitFor(() => expect(rig.mounts.length).toBe(3)); // provider-id dialog
}

describe('/provider add → custom endpoint (interactive)', () => {
  it('auto-discovers models from URL + key and persists the provider', async () => {
    discoverMock.mockResolvedValue([
      { providerId: 'mygw', modelId: 'gpt-4o', contextWindow: 128_000 },
      { providerId: 'mygw', modelId: 'gpt-4o-mini', contextWindow: undefined },
    ]);
    const rig = makeRig();

    await openManualFlow(rig);
    typeInto(rig.mounts[2]!, ' MyGW ');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(4)); // base-url dialog
    typeInto(rig.mounts[3]!, 'https://api.example.com/v1');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(5)); // api-key dialog
    typeInto(rig.mounts[4]!, 'sk-test-key');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(6)); // protocol picker
    rig.mounts[5]!.handleInput('\r'); // default: openai

    await vi.waitFor(() => expect(rig.host.harness.setConfig).toHaveBeenCalledTimes(1));

    expect(discoverMock).toHaveBeenCalledWith(
      [{ id: 'mygw', type: 'openai', baseUrl: 'https://api.example.com/v1', apiKey: 'sk-test-key' }],
      { timeoutMs: 10000 },
    );
    const patch = rig.host.harness.setConfig.mock.calls[0]![0] as {
      providers: Record<string, Record<string, unknown>>;
      models: Record<string, Record<string, unknown>>;
    };
    expect(patch.providers['mygw']).toEqual({
      type: 'openai',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test-key',
      source: { added: 'tui-manual' },
    });
    // Provider id is lowercased; discovered context window is kept, the
    // unlisted model falls back to the discovery default.
    expect(patch.models['mygw/gpt-4o']).toEqual({
      provider: 'mygw',
      model: 'gpt-4o',
      maxContextSize: 128_000,
    });
    expect(patch.models['mygw/gpt-4o-mini']).toEqual({
      provider: 'mygw',
      model: 'gpt-4o-mini',
      maxContextSize: DISCOVERY_DEFAULT_CONTEXT_SIZE,
    });

    await vi.waitFor(() =>
      expect(rig.host.showStatus).toHaveBeenCalledWith(
        'Provider added: mygw (openai, 2 model(s)).',
        'success',
      ),
    );
    expect(rig.host.track).toHaveBeenCalledWith('connect', {
      provider: 'mygw',
      method: 'manual-custom',
    });
    // Ends on the default-model selector, same tail as the catalog flow.
    await vi.waitFor(() =>
      expect(rig.mountNames.at(-1)).toBe('TabbedModelSelectorComponent'),
    );
  });

  it('falls back to manual model names when the endpoint lists nothing (token bundle)', async () => {
    discoverMock.mockResolvedValue([]);
    const rig = makeRig();

    await openManualFlow(rig);
    typeInto(rig.mounts[2]!, 'bundle');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(4));
    typeInto(rig.mounts[3]!, 'https://gateway.example.com/v1');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(5));
    typeInto(rig.mounts[4]!, 'sk-bundle');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(6));
    rig.mounts[5]!.handleInput('\x1b[B'); // openai → anthropic
    rig.mounts[5]!.handleInput('\r');

    await vi.waitFor(() => expect(rig.mounts.length).toBe(7)); // first model-name dialog
    expect(rig.host.showStatus).toHaveBeenCalledWith(
      expect.stringContaining('Could not list models'),
      'warning',
    );
    typeInto(rig.mounts[6]!, 'claude-sonnet-4');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(8)); // next model-name dialog
    typeInto(rig.mounts[7]!, 'gpt-4o');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(9));
    rig.mounts[8]!.handleInput('\r'); // empty submit finishes the list

    await vi.waitFor(() => expect(rig.host.harness.setConfig).toHaveBeenCalledTimes(1));
    const patch = rig.host.harness.setConfig.mock.calls[0]![0] as {
      providers: Record<string, Record<string, unknown>>;
      models: Record<string, Record<string, unknown>>;
    };
    expect(patch.providers['bundle']).toMatchObject({ type: 'anthropic' });
    expect(Object.keys(patch.models).sort()).toEqual([
      'bundle/claude-sonnet-4',
      'bundle/gpt-4o',
    ]);
    expect(patch.models['bundle/gpt-4o']).toEqual({
      provider: 'bundle',
      model: 'gpt-4o',
      maxContextSize: DISCOVERY_DEFAULT_CONTEXT_SIZE,
    });
  });

  it('rejects an invalid provider id without touching the config', async () => {
    const rig = makeRig();
    await openManualFlow(rig);
    typeInto(rig.mounts[2]!, 'My Gateway!');

    await vi.waitFor(() =>
      expect(rig.host.showError).toHaveBeenCalledWith(
        expect.stringContaining('Invalid provider id'),
      ),
    );
    expect(rig.host.harness.setConfig).not.toHaveBeenCalled();
    // Cancelled add re-opens the provider manager.
    await vi.waitFor(() =>
      expect(rig.mountNames.at(-1)).toBe('ProviderManagerComponent'),
    );
  });

  it('rejects a duplicate provider id without touching the config', async () => {
    const rig = makeRig({ mygw: { type: 'openai', baseUrl: 'https://old.example.com/v1' } });
    await openManualFlow(rig);
    typeInto(rig.mounts[2]!, 'mygw');

    await vi.waitFor(() =>
      expect(rig.host.showError).toHaveBeenCalledWith(
        expect.stringContaining('already exists'),
      ),
    );
    expect(rig.host.harness.setConfig).not.toHaveBeenCalled();
  });

  it('cancels cleanly when Esc is pressed at the api-key prompt', async () => {
    const rig = makeRig();
    await openManualFlow(rig);
    typeInto(rig.mounts[2]!, 'mygw');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(4));
    typeInto(rig.mounts[3]!, 'https://api.example.com/v1');
    await vi.waitFor(() => expect(rig.mounts.length).toBe(5));
    rig.mounts[4]!.handleInput('\x1b'); // Esc on the key dialog

    await vi.waitFor(() =>
      expect(rig.mountNames.at(-1)).toBe('ProviderManagerComponent'),
    );
    expect(rig.host.harness.setConfig).not.toHaveBeenCalled();
    expect(discoverMock).not.toHaveBeenCalled();
  });
});
