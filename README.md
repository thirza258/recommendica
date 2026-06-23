# Recommendica

Recommendica is a research recommendation API powered by AI and Retrieval-Augmented Generation (RAG). It helps users find the most relevant research papers based on their input queries.
This project is set up to create a virtual environment, install dependencies, and run a Django server for the Recommendica.

## Setup Instructions

1. Create a virtual environment:
   ```sh
   python -m venv env
   ```

2. Activate the virtual environment:
   - On macOS and Linux:
     ```sh
     source env/bin/activate
     ```
   - On Windows:
     ```sh
     .\env\Scripts\activate
     ```

3. Install dependencies:
   ```sh
   pip install -r requirements.txt
   ```

4. Configure local environment variables:
   - Development uses `.env.development`.
   - Production uses `.env.production`.

5. Import research data:
   ```sh
   python manage.py import_research
   ```

6. Apply migrations:
   ```sh
   python manage.py migrate
   ```

7. Run the app locally:
   ```sh
   make run
   ```
   To run both backend and frontend dev servers together:
   ```sh
   make dev
   ```

## Input Prompt Configuration
- localhost:8000/api/v1/prompt/

```json
{
    "input_prompt": "What is the impact of COVID-19 on the economy?"
}
```

The return response will be the top 5 most relevant research papers to the input prompt.

```json
{
    "status": 200,
    "message": "Success",
    "data": {
        "response": "ai response",
        "research_results": [
            {
                "title": "title",
                "category": "category",
                "summary": "summary",
                "authors": "authors"
            }
        ]
    }
}
```
## API Documentation
- localhost:8000/docs/

## Makefile

- `make run`: start the Django backend with the development env file.
- `make run-frontend`: start the Vite frontend dev server.
- `make dev`: start backend and frontend together.
- `make deploy`: start the Docker Compose stack with the production env file.

## Docker Setup

The production stack uses Docker Compose with the frontend served by nginx.

1. Make sure `.env.production` has the production values you want to deploy.
2. Start the stack:
   ```sh
   make deploy
   ```
3. Open the services:
   - Frontend: localhost:5156
   - Backend API: localhost:8000/api/v1/
   - API docs: localhost:8000/docs/
4. Optionally import the sample research data after the backend is running:
   ```sh
   docker compose exec backend python manage.py import_research
   ```
