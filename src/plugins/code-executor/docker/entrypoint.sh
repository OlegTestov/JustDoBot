#!/bin/bash
set -e

# NOTE: Proxy env vars (NODE_OPTIONS, GLOBAL_AGENT_*) are set as container-level
# env vars via `docker run -e`, NOT here. This is because `docker exec` bypasses
# the entrypoint — env vars exported here would NOT be visible to `docker exec`.
# Container-level env vars ARE inherited by `docker exec` processes.

# Git configuration (from env vars, writes to files — persists for docker exec)
if [ -n "$GIT_USER_NAME" ]; then
  git config --global user.name "$GIT_USER_NAME"
fi
if [ -n "$GIT_USER_EMAIL" ]; then
  git config --global user.email "$GIT_USER_EMAIL"
fi
if [ -n "$GIT_TOKEN" ]; then
  git config --global credential.helper store
  echo "https://oauth2:${GIT_TOKEN}@github.com" > /home/coder/.git-credentials
  chmod 600 /home/coder/.git-credentials
fi

exec "$@"
