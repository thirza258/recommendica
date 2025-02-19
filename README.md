# Recommendica

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