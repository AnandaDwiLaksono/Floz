FROM node:22-alpine
WORKDIR /app
COPY dist ./dist
COPY test/fixtures/sigterm-proof.mjs ./test/fixtures/sigterm-proof.mjs
COPY test/sigterm-proof.mjs ./test/sigterm-proof.mjs
CMD ["node", "test/sigterm-proof.mjs"]
