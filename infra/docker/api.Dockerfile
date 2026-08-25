FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @floz/api build
CMD ["node", "apps/api/dist/main.js"]
