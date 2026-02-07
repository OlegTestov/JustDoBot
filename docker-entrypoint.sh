#!/bin/sh
set -e

# Decode credentials from env var and write to SDK path
if [ -n "$CLAUDE_CREDENTIALS_B64" ]; then
  mkdir -p "$HOME/.claude"
  echo "$CLAUDE_CREDENTIALS_B64" | base64 -d > "$HOME/.claude/.credentials.json"
  chmod 600 "$HOME/.claude/.credentials.json"
  unset CLAUDE_CREDENTIALS_B64
fi

exec "$@"
