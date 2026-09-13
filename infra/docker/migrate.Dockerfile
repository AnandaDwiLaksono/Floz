FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5 AS build
WORKDIR /app
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @floz/database build
RUN pnpm --filter @floz/database deploy --prod /out
RUN cp -a database/dist /out/dist && cp -a database/drizzle /out/drizzle

FROM node:22-bookworm-slim@sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* && groupadd --system floz && useradd --system --gid floz --create-home --home-dir /home/floz floz
COPY --from=build --chown=floz:floz /out/ /app/
USER floz
ENTRYPOINT ["node", "dist/migrate.js"]
