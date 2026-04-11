# ChainPass API — monorepo build (@chainpass/shared + @chainpass/api).
# Build: docker build -t chainpass-api .
# Run:  docker run --rm -p 3001:3001 -e PORT=3001 -e DATABASE_URL=... -e QR_SIGNING_SECRET=... chainpass-api
# Render / Railway: set root directory to repo root, Dockerfile path `Dockerfile`, bind `PORT` from env.

FROM node:20-alpine
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.6.5 --activate

# Workspace manifests (all members must exist for pnpm install).
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY shared/package.json ./shared/
COPY client/package.json ./client/
COPY server/api/package.json ./server/api/
COPY server/indexer/package.json ./server/indexer/

RUN pnpm install --frozen-lockfile

COPY shared ./shared
COPY server/api ./server/api

RUN pnpm --filter @chainpass/shared build && pnpm --filter @chainpass/api build

WORKDIR /app/server/api
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "dist/index.js"]
