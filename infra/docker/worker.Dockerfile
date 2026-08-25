FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @floz/worker build
CMD ["node", "apps/worker/dist/main.js"]
