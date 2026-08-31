migrate: python manage.py migrate --noinput
web: gunicorn recommendica.wsgi:application --worker-class gthread --workers ${GUNICORN_WORKERS:-2} --threads ${GUNICORN_THREADS:-8} --timeout ${GUNICORN_TIMEOUT:-900} --graceful-timeout 30 --access-logfile - --error-logfile -
