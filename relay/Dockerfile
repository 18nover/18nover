FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24.19.0-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg tini ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 nover \
    && useradd --uid 10001 --gid 10001 --home-dir /nonexistent --shell /usr/sbin/nologin nover \
    && mkdir -p /var/lib/nover \
    && chown 10001:10001 /var/lib/nover
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/package.json ./
COPY --from=build --chown=10001:10001 /app/node_modules ./node_modules
COPY --from=build --chown=10001:10001 /app/dist ./dist
USER 10001:10001
ENV NODE_ENV=production
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "--enable-source-maps", "dist/index.js"]
