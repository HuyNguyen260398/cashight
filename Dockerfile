# syntax=docker/dockerfile:1

# node:22-bookworm-slim (multi-arch index; Dependabot bumps the digest).
FROM node:26-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
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
