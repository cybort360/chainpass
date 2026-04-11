> ## Documentation Index
> Fetch the complete documentation index at: https://docs.privy.io/llms.txt
> Use this file to discover all available pages before exploring further.

# Build with AI tools

> Build with Privy faster using AI tools like Cursor, Claude, and other LLM powered coding assistants

## MCP server

[Model Context Protocol (MCP)](https://modelcontextprotocol.io/) is an open standard that lets AI assistants securely access external data sources. Privy's MCP server connects your AI coding assistant directly to our documentation, giving it live access to search and retrieve the exact information you need in real time.

### Setup with Cursor

<Steps>
  <Step title="Open MCP settings">
    In Cursor, open **Settings** and navigate to **Tools & MCP**, then click **Add MCP Server**
  </Step>

  <Step title="Add Privy docs server">
    In the `mcp.json` configuration file, add:

    ```json  theme={"system"}
    {
      "mcpServers": {
        "privy-docs": {
          "url": "https://docs.privy.io/mcp"
        }
      }
    }
    ```
  </Step>

  <Step title="Save and restart">Save the file and restart Cursor to apply the changes</Step>

  <Step title="Start building">
    Your AI assistant can now access Privy docs in real time. Try asking: "How do I add Privy login to my React app?"
  </Step>
</Steps>

### Setup with Claude Desktop

<Steps>
  <Step title="Find your config file">
    Open your Claude Desktop configuration file:

    * **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
    * **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
  </Step>

  <Step title="Add Privy MCP server">
    Add this to the `mcpServers` section:

    ```json  theme={"system"}
    {
      "mcpServers": {
        "privy-docs": {
          "url": "https://docs.privy.io/mcp"
        }
      }
    }
    ```
  </Step>

  <Step title="Restart Claude">
    Restart Claude Desktop to load the new server
  </Step>

  <Step title="Verify it works">
    Ask Claude: "Search Privy docs for wallet creation" to test the connection
  </Step>
</Steps>

## Agent skill

Privy publishes an [Agent Skill](https://agentskills.io) — a structured capability file that tells AI coding agents what Privy can do, what inputs are needed, and common pitfalls to avoid. Unlike MCP (live doc search) or static files (raw doc dump), the skill gives your agent decision guidance, implementation workflows, and quick references that are automatically loaded when relevant.

### Setup with Claude Code

<Steps>
  <Step title="Install the skill">
    Run this from your project root:

    ```bash  theme={"system"}
    npx skills add https://docs.privy.io -a claude-code --project -y
    ```

    This creates `.claude/skills/privy/SKILL.md` in your project directory.
  </Step>

  <Step title="Verify it works">
    Open Claude Code and run `/skills` to confirm the Privy skill appears. Your agent now
    automatically loads Privy context when you work on authentication, wallets, or blockchain
    interactions.
  </Step>

  <Step title="Commit to your repo">
    Commit the `.claude/skills/` directory so everyone on your team gets the skill automatically.
  </Step>
</Steps>

<Tip>
  If you prefer not to use the skills CLI, you can install manually:

  ```bash  theme={"system"}
  mkdir -p .claude/skills/privy && curl -fsSL https://docs.privy.io/skill.md -o .claude/skills/privy/SKILL.md
  ```
</Tip>

### Setup with other agents

The Privy skill works with any tool that supports the [Agent Skills](https://agentskills.io) standard, including Cursor, VS Code Copilot, Gemini CLI, OpenAI Codex, and more.

```bash  theme={"system"}
npx skills add https://docs.privy.io
```

The CLI detects your installed agents and places the skill in the correct directory for each one.

### What the skill provides

| Feature                    | Description                                                              |
| -------------------------- | ------------------------------------------------------------------------ |
| **Quick references**       | SDK install commands, common API patterns, wallet operation tables       |
| **Decision guidance**      | When to use embedded vs external wallets, client vs server signing       |
| **Workflows**              | Step-by-step implementation sequences for auth, wallets, and policies    |
| **Common gotchas**         | Known pitfalls like missing the `ready` flag or authorization signatures |
| **Verification checklist** | Pre-submission checks for credentials, chain IDs, error handling         |

## Static docs files

If your AI tool doesn't support MCP yet, you can use one of Privy's static documentation files instead.

<Warning>
  Static files are snapshots and may not include the latest updates. Use MCP when possible for
  always current docs.
</Warning>

### Which file should I use?

* `llms.txt` is a curated overview of Privy. It is best for routing an agent to the right docs, understanding product structure, and choosing the right integration path.
* `llms-full.txt` is a full static snapshot of the documentation. It is best when your tool needs more exhaustive reference material in one file.

### Setup with Cursor

<Steps>
  <Step title="Open docs settings">Go to **Settings** > **Features** > **Docs**</Step>

  <Step title="Add the overview file">
    Click "Add new doc" and paste: `https://docs.privy.io/llms.txt`
  </Step>

  <Step title="Optionally add the full snapshot">
    If your agent needs deeper static reference coverage, add: `https://docs.privy.io/llms-full.txt`
  </Step>

  <Step title="Reference in chat">
    Use `@docs -> Privy` in your AI chat to reference the documentation
  </Step>
</Steps>

### Setup with Claude Desktop

<Steps>
  <Step title="Download the overview file">
    Download the curated overview from: `https://docs.privy.io/llms.txt`
  </Step>

  <Step title="Optionally download the full snapshot">
    Download the full documentation snapshot from: `https://docs.privy.io/llms-full.txt`
  </Step>

  <Step title="Add to your project">
    Save one or both files in your project directory or a known location on your system
  </Step>

  <Step title="Reference in chat">
    Drag and drop the file into your Claude Desktop chat, or use the attachment button to upload it. Claude will then have access to the uploaded Privy documentation context for that conversation
  </Step>
</Steps>


Built with [Mintlify](https://mintlify.com).