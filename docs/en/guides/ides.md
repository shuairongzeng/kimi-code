# Using Zimi Code CLI in IDEs

Zimi Code CLI supports integration into IDEs via the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/), letting you use AI-assisted coding directly inside your editor.

## Prerequisites

Before configuring your IDE, make sure Zimi Code CLI is installed and you have completed the login setup.

The ACP server is exposed as the `zimi acp` subcommand. The IDE launches it as a child process and communicates over stdin/stdout using JSON-RPC. Each time the IDE creates a session, the CLI reuses its existing authentication state — no need to log in again.

::: tip Path note
Child processes launched from an IDE GUI on macOS typically do **not** inherit the terminal shell's `PATH`. If `zimi` is not in a system directory like `/usr/local/bin`, use the absolute path in your IDE configuration. Run `which zimi` in a terminal to find the active path.
:::

## Using Zimi Code CLI in Zed

[Zed](https://zed.dev/) is a modern editor with native ACP support.

Add the following to Zed's config file at `~/.config/zed/settings.json`:

```json
{
  "agent_servers": {
    "Zimi Code CLI": {
      "type": "custom",
      "command": "zimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

Configuration fields:

- `type`: fixed value `"custom"`
- `command`: path to the Zimi Code CLI executable. If `zimi` is not on `PATH`, use the full path (e.g. `/Users/you/.local/bin/zimi`).
- `args`: startup arguments. The `acp` subcommand switches the CLI into ACP mode.
- `env`: additional environment variables; usually leave this empty. Zed injects a default environment automatically.

After saving, open a new conversation in Zed's Agent panel and it will launch a `Zimi Code CLI` ACP subprocess using the configuration above. MCP servers declared in Zed's `agent_servers` section are also forwarded to the zimi side via the ACP protocol.

## Using Zimi Code CLI in JetBrains IDEs

JetBrains IDEs (IntelliJ IDEA, PyCharm, WebStorm, etc.) support ACP through the AI chat plugin.

If you do not have a JetBrains AI subscription, you can enable `llm.enable.mock.response` in the Registry to access the AI chat panel in ACP-only scenarios. Press Shift twice and search for "Registry" to open it.

In the AI chat panel menu, click **Configure ACP agents** and add the following configuration:

```json
{
  "agent_servers": {
    "Zimi Code CLI": {
      "command": "~/.local/bin/zimi",
      "args": ["acp"],
      "env": {}
    }
  }
}
```

JetBrains is strict about the `command` field — always use an **absolute path**, which you can get by running `which zimi` in a terminal. After saving, `Zimi Code CLI` will appear in the AI chat's agent selector.

## Using Zimi Code CLI in Paseo

[Paseo](https://paseo.sh/) is a self-hosted orchestrator that runs and supervises agent CLIs from your desktop, web, and mobile. It connects to Zimi Code CLI over ACP, the same way an IDE does.

Pick **Zimi Code CLI** from Paseo's built-in ACP provider catalog, or add a custom provider in `~/.paseo/config.json`:

```json
{
  "agents": {
    "providers": {
      "zimi": {
        "extends": "acp",
        "label": "Zimi Code CLI",
        "command": ["zimi", "acp"]
      }
    }
  }
}
```

Paseo's generic ACP adapter does not drive the login flow, so complete the terminal login first (see [Prerequisites](#prerequisites)) — otherwise session creation fails with `Authentication required`.

## Troubleshooting

- **Session disconnects immediately / IDE shows "agent exited"**: usually a wrong `command` path or a missing login. Run `zimi acp` in a terminal first to verify — if it blocks waiting for stdin, the CLI itself is fine and the problem is in the IDE configuration; if it exits immediately with an error, follow the error message (most commonly you need to run `/login`).
- **IDE shows "auth required"**: the CLI has no usable authentication token. Exit the IDE, run `zimi` in a terminal to complete login, then restart the IDE.
- **MCP tools not visible**: check the [`zimi acp` reference](../reference/zimi-acp.md) capability table to confirm that the MCP transport type configured in your IDE is supported. The Zimi Code CLI ACP server currently supports `http`, `stdio`, and `sse` transports; `acp` transport MCP servers are silently dropped and a warning is written to the log.

## Next steps

- [zimi acp reference](../reference/zimi-acp.md) — ACP capability matrix and method coverage details
- [zimi command reference](../reference/zimi-command.md) — full subcommand list
