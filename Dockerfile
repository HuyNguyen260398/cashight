# syntax=docker/dockerfile:1

# node:22-bookworm-slim (multi-arch index; Dependabot bumps the digest).
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS build
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
# gcr.io/distroless/nodejs22-debian12:nonroot (multi-arch index; Dependabot bumps the digest).
FROM gcr.io/distroless/nodejs22-debian12:nonroot@sha256:13593b7570658e8477de39e2f4a1dd25db2f836d68a0ba771251572d23bb4f8e
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /src/dist/servers/ /app/
EXPOSE 8080
# The image entrypoint is node; the workload is chosen by overriding this argument.
CMD ["/app/api/index.js"]
