# JustDoBot

JustDoBot is a Claude Code-based AI workhorse for everyday life and work, using Telegram as the primary interface.
It runs on a Claude subscription workflow, so in this mode you do not pay per-request API costs.
It is security-first, multilingual, and easy to set up with one command plus a graphical setup panel.
The architecture is plugin-based, so features can be extended without rewriting the whole bot.

## Installation

Install the bot with one command:

```bash
curl -fsSL https://justdobot.com/install.sh | bash
```

It installs dependencies and opens the setup UI in your browser.

## How JustDoBot Works

```mermaid
flowchart TD
  subgraph runOptions [Run Options]
    oneCommand["One-command install"]
    localRun["Local run (bun run start)"]
    dockerRun["Docker run (bun run docker)"]
  end

  subgraph coreFlow [Core Flow]
    telegramUser["You in Telegram"]
    justDoBot["JustDoBot (Claude Code-based)"]
    streamReply["Streaming reply in chat"]
    memoryGoals["Auto memory and goals"]
    proactiveNudges["Proactive nudges when needed"]
  end

  subgraph optionalModules [Optional Modules]
    obsidian["Obsidian knowledge search"]
    googleData["Gmail and Calendar context"]
    voiceCalls["Voice and urgent Twilio calls"]
    codingSandbox["Coding sandbox project delivery"]
  end

  oneCommand --> justDoBot
  localRun --> justDoBot
  dockerRun --> justDoBot
  telegramUser --> justDoBot
  justDoBot --> streamReply
  justDoBot --> memoryGoals
  justDoBot --> proactiveNudges
  justDoBot --> obsidian
  justDoBot --> googleData
  justDoBot --> voiceCalls
  justDoBot --> codingSandbox
```

Use local run for fast development. Use Docker for better isolation and safer production operation.

## Why This Bot

- **Claude Code-based**: real agent workflow, not a simple chatbot wrapper.
- **Subscription workflow**: no API pay-per-call costs in this operating mode.
- **Secure by design**: local data storage, isolated coding sandbox, controlled integrations.
- **Telegram-first UX**: streaming replies directly in Telegram.
- **Multilingual**: supports 15 interface/response languages.
- **Easy setup**: one command install + web setup wizard.
- **Extensible**: plugin architecture for AI, memory, vault, voice, collectors, and code execution.

## How You Use It

1. Chat with the bot in Telegram.
2. Get streaming answers as the response is generated.
3. The bot automatically remembers useful facts and preferences.
4. It tracks goals and deadlines.
5. It can proactively message you when something important needs attention.

## Core Features

- **Telegram assistant with streaming output**: fast, live response updates in chat.
- **Automatic memory**: stores personal preferences, facts, and relevant insights.
- **Goal tracking**: keeps active goals with statuses, notes, and deadlines.
- **Local-first data**: messages, memories, goals, and indexes are stored in local SQLite.
- **Local search index**: full-text search and local vector storage for retrieval.

## Optional Integrations

- **Obsidian vault**: index and search your notes from Telegram.
- **Google Gmail + Calendar**: add context for proactive reminders and nudges.
- **Voice in Telegram**: speech-to-text and text-to-speech for voice workflows.
- **Urgent phone calls via Twilio**: bot can place outbound calls to deliver critical info.
  Full two-way phone conversation mode is planned for an upcoming release.

## Proactive Behavior

When enabled, the bot can start the conversation itself.
It checks relevant signals (like goals, deadlines, calendar, mail, and recent changes) and sends a proactive message only when useful.
It also supports cooldowns and quiet hours to avoid noise.

## Coding Sandbox

You can ask in Telegram: “Build project X”.
The main assistant delegates the task to a dedicated coding agent.
That agent runs code inside an isolated Docker sandbox and can deliver a full project end-to-end.
This includes safe execution boundaries and progress updates back to Telegram.

## Security & Privacy

- Secrets are read from environment variables and `.env` (not committed to git).
- Setup UI runs on `localhost` and masks sensitive values.
- Data is stored locally (SQLite database + local indexes).
- Coding tasks run in an isolated container with restricted resources and network controls.

## Setup and Run

### Manual Setup (alternative to one-command install)

```bash
git clone https://github.com/olegtestov/JustDoBot.git
cd JustDoBot
bun install
bun run web-setup
```

Or use terminal setup:

```bash
bun run setup
```

### Run

```bash
bun run start
```

Best for local development. Less isolated than Docker.

### Docker

```bash
bun run docker
```

Recommended for production. More isolated and safer by default.

## Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and overview |
| `/help` | Command list |
| `/clear` | Start a new session |
| `/cancel` | Stop current response |
| `/goals` | Show active goals |
| `/memory [query]` | Show or search saved memories |
| `/forget <id>` | Delete a memory |
| `/vault [query]` | Vault stats or search |
| `/note <text>` | Create a vault note |
| `/reindex` | Reindex vault content |
| `/quiet [hours]` | Pause proactive messages |
| `/status` | Health and runtime status |
| `/backup` | JSON + SQLite backup |
| `/projects` | List coding projects |
| `/project_stop <name>` | Stop a running coding task |
| `/project_delete <name>` | Delete a project |

## Troubleshooting

```bash
bun run doctor
```

## Development

```bash
bun test
bun run check
bun run lint:fix
```

## More Details

- Full architecture: `spec/ARCHITECTURE.md`
- Configuration options: `config.example.yaml`

## License

MIT
