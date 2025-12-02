FROM python:3.11 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080 \
    LOG_DIR=/var/log/funding-rate-arb-trader

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir uv \
    && uv pip install --no-cache-dir --system -r requirements.txt

COPY app ./app
COPY README.md ./README.md
COPY docker ./docker

RUN chmod +x docker/entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["./docker/entrypoint.sh"]
