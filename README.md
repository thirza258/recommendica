# Recommendica

Recommendica is a research recommendation API powered by AI and Retrieval-Augmented Generation (RAG). It helps users find the most relevant research papers based on their input queries.
This project is set up to create a virtual environment, install dependencies, and run a Django server for the Recommendica.

## Setup Instructions

1. **Create a Virtual Environment:**
    ```sh
    python -m venv env
    ```

2. **Activate the Virtual Environment:**
    - On macOS and Linux:
      ```sh
      source env/bin/activate
      ```
    - On Windows:
      ```sh
      .\env\Scripts\activate
      ```

3. **Install Dependencies:**
    ```sh
    pip install -r requirements.txt
    ```

4. **Configure Environment Variables:**
    - Copy the example environment file to create your own environment configuration:
      ```sh
      cp env.example .env
      ```

5. **Import Research Data:**
    ```sh
    python manage.py import_research
    ```

6. **Apply Migrations:**
    ```sh
    python manage.py migrate
    ```

7. **Run the Django Development Server:**
    ```sh
    python manage.py runserver
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

## Docker Setup

The project can run with Docker Compose using Python 3.11 for the Django backend and a built frontend served by nginx.

1. **Create an environment file when you need API keys:**
    ```sh
    cp .env.example .env
    ```
   If you run the frontend locally with Vite, copy the frontend example too:
   ```sh
   cp recommendica_frontend/.env.example recommendica_frontend/.env
   ```

2. **Start the backend and frontend:**
    ```sh
    docker compose up --build
    ```

3. **Open the services:**
    - Frontend: localhost:5156
    - Backend API: localhost:8000/api/v1/
    - API docs: localhost:8000/docs/

4. **Optionally import the sample research data after the backend is running:**
    ```sh
    docker compose exec backend python manage.py import_research
    ```
