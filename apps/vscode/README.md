# Zimi Code

AI coding assistant for VS Code, built for long-context workflows and complex coding tasks.

## Features

- **Works alongside you**: Zimi autonomously explores your codebase, reads and writes code, and runs terminal commands with your permission
- **Thinking controls**: Toggle reasoning or choose a model-supported thinking effort
- **Provider-aware models**: Distinguish and select same-named models across configured providers
- **Native editor integration**: Review AI-proposed changes directly in VS Code's diff viewer
- **MCP support**: Extend capabilities with Model Context Protocol servers
- **Slash commands**: Quick actions like `/init` to analyze your project and `/compact` to manage context

## Install

Zimi Code requires VS Code 1.100.0 or later.

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=zimi-ai.zimi-code)
2. Open a folder in VS Code
3. Click the Zimi icon in the Activity Bar
4. Sign in with a [zimi.com/code](https://www.zimi.com/code) subscription, or use a provider already configured in the shared `config.toml`

The extension runs the Zimi Code Node SDK in the VS Code Extension Host. When
the extension and the Zimi Code terminal app resolve to the same
`ZIMI_CODE_HOME`, they share `config.toml`, MCP configuration, login state, and
sessions. The system-level `ZIMI_CODE_HOME` environment variable is supported;
there is no separate VS Code setting for it. Do not run the same session from
both applications at the same time, because cross-process session locking is
not guaranteed.

After upgrading from version 0.5.x, the extension prompts before migrating any
legacy data it finds. Migration copies or merges data into the current Zimi Code
home and does not delete the legacy source. Legacy Zimi Code OAuth and MCP OAuth
credentials are not copied, so those connections must be authorized again.
See [the changelog](CHANGELOG.md) for the full compatibility notes.

## Docs

Official doc for Zimi Code can be found at [www.zimi.com/code/docs](https://www.zimi.com/code/docs/en/zimi-code-for-vscode/guides/getting-started.html)

## License

[Apache-2.0](LICENSE)
