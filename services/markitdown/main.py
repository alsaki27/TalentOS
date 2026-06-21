from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
import tempfile
import os
from markitdown import MarkItDown

app = FastAPI(title="TalentOS Markitdown Service")


@app.post("/parse")
async def parse_pdf(file: UploadFile = File(...)):
    # Validate file extension
    if not file.filename.endswith('.pdf'):
        return JSONResponse(
            {"success": False, "error": "Only PDF files are supported"},
            status_code=400
        )
    
    # Save uploaded file to a temporary location
    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name
    
    try:
        # Convert PDF to markdown using Microsoft's markitdown
        md = MarkItDown()
        result = md.convert(tmp_path)
        return {"success": True, "markdown": result.text_content}
    except Exception as e:
        return JSONResponse(
            {"success": False, "error": str(e)},
            status_code=500
        )
    finally:
        # Clean up temporary file
        os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
