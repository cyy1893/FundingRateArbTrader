FROM python:3.11 AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple
ARG PIP_TRUSTED_HOST=pypi.tuna.tsinghua.edu.cn

WORKDIR /app

COPY requirements.txt .
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip -i ${PIP_INDEX_URL} --trusted-host ${PIP_TRUSTED_HOST} \
    && /opt/venv/bin/pip install --no-cache-dir -r requirements.txt -i ${PIP_INDEX_URL} --trusted-host ${PIP_TRUSTED_HOST}

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
