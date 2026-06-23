.PHONY: run run-backend run-frontend dev deploy

run: run-backend

run-backend:
	@DEVELOPMENT_MODE=True python manage.py runserver 0.0.0.0:8000

run-frontend:
	@cd frontend && npm run dev

dev:
	@$(MAKE) -j2 run-backend run-frontend

deploy:
	@docker compose --env-file .env.production up --build -d
