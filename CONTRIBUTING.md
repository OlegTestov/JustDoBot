# Contributing to JustDoBot

Thank you for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Bun](https://bun.sh/) (latest)
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (logged in via `claude login`)
- A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Setup

```bash
git clone https://github.com/OlegTestov/JustDoBot.git
cd JustDoBot
bun install
bun run web-setup   # opens setup wizard at http://localhost:19380
```

## Development workflow

```bash
bun run dev         # start with --watch (auto-restart on changes)
bun test            # run all 253 tests
bun run typecheck   # TypeScript strict mode check
bun run lint        # Biome linter
bun run check       # typecheck + lint combined
bun run doctor      # diagnostics (config, DB, Docker, etc.)
```

## Code style

The project uses [Biome](https://biomejs.dev/) for linting and formatting:

- 2-space indentation, double quotes, semicolons
- Line width: 100 characters
- Auto-fix: `bun run lint:fix`

## Project structure

```
src/
  index.ts                 # Main orchestrator
  config.ts                # YAML config + Zod validation
  core/                    # Framework: context builder, search, sessions, queue
  plugins/
    ai-engines/            # Claude Agent SDK integration
    database/sqlite/       # SQLite repositories (FTS5 + sqlite-vec)
    messengers/telegram/   # Grammy handlers, streaming, middleware
    vault/obsidian/        # Obsidian vault indexing
    voice/                 # STT/TTS providers, Twilio calls
    code-executor/docker/  # Docker sandbox for code execution
    collectors/            # Google, goals, vault change collectors
    embeddings/            # OpenAI embedding provider
tests/                     # Mirrors src/ structure
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full technical specification.

## Pull request guidelines

1. Create a feature branch from `main`
2. Make sure `bun run check` and `bun test` pass
3. Keep PRs focused on a single change
4. Write tests for new functionality
5. Follow existing code patterns and naming conventions

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
