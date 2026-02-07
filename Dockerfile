FROM oven/bun:latest

# Docker CLI + buildx (for Stage 6: Code Agent sandbox management)
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker/buildx-bin:latest /buildx /usr/libexec/docker/cli-plugins/docker-buildx

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .

RUN useradd -m -s /bin/sh botuser
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh
RUN chown -R botuser:botuser /app
USER botuser

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=15s \
  CMD ["bun", "run", "src/healthcheck.ts"]

STOPSIGNAL SIGTERM
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
