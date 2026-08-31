FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY . .

RUN mkdir -p /app/staticfiles

EXPOSE 8000

# Served by gunicorn, not `manage.py runserver` — the dev server is
# single-process, reloads on file writes, and is explicitly unsupported for
# production traffic.
#
# gthread (not the default sync worker) matters for the SSE endpoint: a sync
# worker handles one request at a time and calls notify() per request, so a
# multi-minute stream both blocks every other request on that worker and can
# trip --timeout. The gthread worker notifies from its accept loop and serves
# --threads requests concurrently, so long-lived streams stay safe.
#
# `exec` keeps gunicorn as the signalled process so SIGTERM means a graceful
# drain rather than a hard kill.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py collectstatic --noinput && exec gunicorn recommendica.wsgi:application \
    --bind 0.0.0.0:8000 \
    --worker-class gthread \
    --workers ${GUNICORN_WORKERS:-2} \
    --threads ${GUNICORN_THREADS:-8} \
    --timeout ${GUNICORN_TIMEOUT:-900} \
    --graceful-timeout 30 \
    --keep-alive 5 \
    --worker-tmp-dir /dev/shm \
    --access-logfile - \
    --error-logfile - \
    --log-level ${GUNICORN_LOG_LEVEL:-info}"]
