import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.main import app


@app.middleware("http")
async def normalize_vercel_path(request, call_next):
    if request.scope["path"] in ("/api/index.py", "/api/index"):
        request.scope["path"] = "/"
    return await call_next(request)
