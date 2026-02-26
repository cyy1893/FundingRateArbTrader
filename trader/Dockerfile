FROM python:3.11 AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt

FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    LOG_DIR=/var/log/funding-rate-arb-trader \
    PATH="/opt/venv/bin:$PATH"

WORKDIR /app

COPY --from=builder /opt/venv /opt/venv
COPY app ./app
COPY README.md ./README.md
COPY docker ./docker

RUN groupadd -g 10001 app \
    && useradd -u 10001 -g app -m -d /home/app -s /usr/sbin/nologin app \
    && chown -R app:app /app /opt/venv /home/app \
    && chmod +x docker/entrypoint.sh

USER app

EXPOSE 8080

ENTRYPOINT ["./docker/entrypoint.sh"]
