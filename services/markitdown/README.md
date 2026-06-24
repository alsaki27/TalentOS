# TalentOS Markitdown Service

A lightweight FastAPI microservice that converts PDF files to Markdown using [Microsoft's markitdown](https://github.com/microsoft/markitdown) library.

## What This Service Does

Provides a single HTTP endpoint `POST /parse` that accepts a PDF file via multipart form upload and returns the extracted content as Markdown text.

## Installation

```bash
cd services/markitdown
pip install -r requirements.txt
```

## Running the Service

```bash
python main.py
```

The server will start on `http://localhost:8000`.

## API Usage

### Endpoint

`POST /parse`

### Request

- **Content-Type:** `multipart/form-data`
- **Field:** `file` — the PDF file to convert

### Response

**Success (200):**
```json
{
  "success": true,
  "markdown": "# Extracted Content\n\n..."
}
```

**Error (400):**
```json
{
  "success": false,
  "error": "Only PDF files are supported"
}
```

**Error (500):**
```json
{
  "success": false,
  "error": "<conversion error message>"
}
```

## Testing with cURL

```bash
curl -X POST -F "file=@resume.pdf" http://localhost:8000/parse
```

## Production Deployment Notes

- **Port:** The service listens on port `8000`. Adjust the `uvicorn.run()` call in `main.py` or set via environment variable if needed.
- **Workers:** For production, run Uvicorn with multiple workers: `uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4`
- **Temp files:** The service writes uploaded files to a temporary directory and cleans them up after processing. Ensure the host system has adequate temp disk space for large PDFs.
- **Containerization:** You can containerize this service with a minimal Python image (e.g., `python:3.11-slim`). Include system dependencies if `markitdown` requires them (e.g., `poppler-utils` for PDF parsing).
- **Health checks:** Add a `GET /health` endpoint if deploying behind a load balancer.
- **File size limits:** Consider adding a max file size limit or timeout for large PDFs.
