FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @floz/worker build
RUN pnpm --filter @floz/worker deploy --prod /out
RUN cp -a apps/worker/dist /out/dist

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --system floz && useradd --system --gid floz --create-home --home-dir /home/floz floz && install -d -m 0700 -o floz -g floz /run/floz-worker
COPY --from=build --chown=floz:floz /out/ /app/
USER floz
HEALTHCHECK --interval=30s --start-period=30s --timeout=5s --retries=3 CMD ["node", "dist/health.js"]
ENTRYPOINT ["node", "dist/main.js"]
