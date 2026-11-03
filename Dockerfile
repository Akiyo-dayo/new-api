FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# The vibe cache lives on a volume; it must survive image upgrades and be writable by the
# unprivileged user that runs the service.
RUN mkdir -p /data/vibe-cache \
    && groupadd --gid 10001 adapter \
    && useradd --uid 10001 --gid adapter --create-home --shell /usr/sbin/nologin adapter \
    && chown -R adapter:adapter /data

USER adapter

EXPOSE 8000

# One worker on purpose: the per-token lock table lives in this process (see README).
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
