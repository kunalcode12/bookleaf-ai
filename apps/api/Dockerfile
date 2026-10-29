# BookLeaf Support API (+ background worker: same image, `node dist/worker.js`).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t bookleaf-api .
# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/db/package.json packages/db/
COPY packages/ai/package.json packages/ai/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --filter @bookleaf/api...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @bookleaf/api build \
 && pnpm --filter @bookleaf/api deploy --prod /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD wget -qO- http://127.0.0.1:${PORT:-4000}/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
