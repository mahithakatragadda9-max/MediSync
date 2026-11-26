import sys
from pathlib import Path
from urllib.parse import parse_qs, urlencode

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
from app.main import app


@app.middleware("http")
async def restore_vercel_original_path(request, call_next):
    raw_qs = request.scope.get("query_string", b"").decode("utf-8")
    params = parse_qs(raw_qs, keep_blank_values=True)
    if "__path" in params:
        orig_path = params.pop("__path")[0]
        if not orig_path.startswith("/"):
            orig_path = "/" + orig_path
        request.scope["path"] = orig_path
        request.scope["raw_path"] = orig_path.encode("utf-8")
        new_qs = urlencode(params, doseq=True).encode("utf-8")
        request.scope["query_string"] = new_qs
    elif request.scope["path"] in ("/api/index.py", "/api/index"):
        request.scope["path"] = "/"
        request.scope["raw_path"] = b"/"
    return await call_next(request)
