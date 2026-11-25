import logging
import os
from pathlib import Path
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env", override=True)

DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
SAMPLE_DIR = DATA_DIR / "samples"
DB_PATH = Path(os.getenv("MEDISYNC_DB_PATH", str(DATA_DIR / "medisync.db")))

DATA_DIR.mkdir(parents=True, exist_ok=True)
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip().strip('"').strip("'")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "").strip().strip('"').strip("'")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip().strip('"').strip("'")
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "").strip().strip('"').strip("'")
GROQ_MODEL = (os.getenv("GROQ_MODEL", "openai/gpt-oss-120b").strip().strip('"').strip("'") or "llama-3.3-70b-versatile")

JWT_SECRET = os.getenv("MEDISYNC_JWT_SECRET", "medisync-local-demo-secret-key-2026")
JWT_ALGORITHM = "HS256"
TOKEN_EXPIRY_HOURS = 24

HAS_SUPABASE = bool(SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)
HAS_GROQ = bool(GROQ_API_KEY)
DEMO_MODE = os.getenv("MEDISYNC_DEMO_MODE", "true").lower() == "true" or not HAS_SUPABASE

CORS_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "MEDISYNC_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000,null",
    ).split(",")
    if origin.strip()
]
