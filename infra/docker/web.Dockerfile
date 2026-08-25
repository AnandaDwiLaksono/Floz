FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @floz/web build
CMD ["pnpm", "--filter", "@floz/web", "start"]
