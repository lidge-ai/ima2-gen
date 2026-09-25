# syntax=docker/dockerfile:1
# ima2-gen server image (issue #114).
# Build:  docker build -t ima2-gen .
# Run:    docker run -p 3333:3333 -e IMA2_LAN_TOKEN=<secret> -v ima2-data:/data ima2-gen
# Notes:  IMA2_LAN_TOKEN is REQUIRED — the server refuses to bind a non-loopback
#         host without it (see docs/DOCKER.md).

FROM node:22-bookworm-slim AS build
WORKDIR /app

# Install deps first for layer caching.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY ui/package.json ui/package-lock.json ./ui/
RUN npm --prefix ui ci --no-audit --no-fund

COPY . .
RUN npm run ui:build && npm run build:server && npm run build:cli

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    IMA2_CONFIG_DIR=/data \
    IMA2_HOST=0.0.0.0 \
    IMA2_PORT=3333

# Runtime dependency install (prod only). Keep parity with package.json files[].
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev --no-audit --no-fund

# Built artifacts + runtime assets — keep in sync with package.json "files".
COPY --from=build /app/server.js /app/config.js ./
COPY --from=build /app/bin ./bin
COPY --from=build /app/lib ./lib
COPY --from=build /app/routes ./routes
COPY --from=build /app/ui/dist ./ui/dist
COPY --from=build /app/skills ./skills
COPY --from=build /app/assets ./assets
COPY --from=build /app/integrations ./integrations
COPY --from=build /app/docs ./docs

VOLUME /data
EXPOSE 3333

# Run the server entry directly: `ima2 serve` drops into an interactive setup
# wizard when /data has no provider config, which would hang a container.
CMD ["node", "server.js"]
