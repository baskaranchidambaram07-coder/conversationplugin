# Built from the repository root: docker build --file backend/Dockerfile .
# The root .dockerignore admits only the files named there, so local settings and tools never reach an image.

# The loader and the chat, which the gateway serves from its own origin.
FROM node:24-slim AS web
WORKDIR /src
COPY package.json package-lock.json tsconfig.base.json ./
COPY protocol ./protocol
COPY web ./web
COPY e2e/package.json ./e2e/
RUN npm ci --no-audit --no-fund && npm run build --workspace @ucp/loader --workspace @ucp/widget

FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /bin/uv
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-dev
COPY backend/ucp ./ucp

FROM python:3.12-slim
RUN useradd --system --uid 10001 --no-create-home app
WORKDIR /app
COPY --from=build /app /app
COPY --from=web /src/web/loader/dist ./web/loader/dist
COPY --from=web /src/web/widget/dist ./web/widget/dist
# The widget files the release publishes in each environment (infra/aws/deploy.py).
COPY backend/deploy ./deploy
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 UCP_WEB_DIR=/app/web
USER 10001
EXPOSE 8000
# No server header and our own access log (ucp.gateway.pipeline); the client address comes from the load balancer,
# the only thing that can reach the container; open answers get up to 110 s to finish when a task is replaced.
CMD ["uvicorn", "ucp.gateway.app:app", "--host", "0.0.0.0", "--port", "8000", "--no-server-header", \
     "--no-access-log", "--proxy-headers", "--forwarded-allow-ips", "*", "--timeout-graceful-shutdown", "110"]
