# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /src
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/domain/package.json packages/domain/package.json
RUN pnpm install --frozen-lockfile

COPY tsconfig.json ./
COPY backend backend
COPY packages packages
COPY scripts/build-servers.mjs scripts/build-servers.mjs
RUN node scripts/build-servers.mjs

# Distroless: no shell, no package manager, runs as uid 65532.
FROM gcr.io/distroless/nodejs22-debian12:nonroot
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/dist/servers/ /app/
EXPOSE 8080
# The image entrypoint is node; the workload is chosen by overriding this argument.
CMD ["/app/api/index.js"]
