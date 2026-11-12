FROM python:3.12-slim AS build
COPY --from=ghcr.io/astral-sh/uv:0.9.24 /uv /bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY ucp ./ucp

FROM python:3.12-slim
RUN useradd --system --uid 10001 --no-create-home app
WORKDIR /app
COPY --from=build /app /app
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1
USER 10001
EXPOSE 8000
CMD ["uvicorn", "ucp.gateway.app:app", "--host", "0.0.0.0", "--port", "8000"]
