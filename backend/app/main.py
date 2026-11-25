import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.auth import create_access_token, get_current_user, hash_password, require_role, verify_password
from app.config import CORS_ORIGINS, DEMO_MODE, HAS_GROQ, HAS_SUPABASE, SAMPLE_DIR, UPLOAD_DIR
from app.db import (
    default_device_connectors,
    generate_medisync_id,
    get_conn,
    get_user_by_email,
    init_db,
    log_audit,
    seed_demo_data,
    utcnow_iso,
)
from app.sample_data import ensure_sample_files
from app.services.ai_assistant import answer_health_question
from app.services.pdf_extractor import extract_medical_entities, extract_text_from_pdf_bytes
from app.services.qr_service import build_privacy_safe_qr_payload, generate_qr_data_uri, generate_qr_png_bytes
from app.services.wearable_engine import parse_wearable_file, recompute_patient_intelligence

app = FastAPI(
    title="MediSync API",
    description="AI-Powered Personal Health Intelligence Platform API",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    ensure_sample_files()
    seed_demo_data()


# ---------------------------------------------------------------------------
# Pydantic Schemas
# ---------------------------------------------------------------------------
class RegisterRequest(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=5, max_length=150)
    password: str = Field(..., min_length=8, max_length=128)
    role: str = Field(default="patient", pattern="^(patient|professional)$")
    age: int | None = Field(default=None, ge=1, le=120)
    sex: str | None = None
    blood_group: str | None = None
    specialty: str | None = None
    registration_number: str | None = None
    facility_name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str


class PatientProfileUpdate(BaseModel):
    age: int | None = Field(default=None, ge=1, le=120)
    sex: str | None = None
    blood_group: str | None = None
    height_cm: float | None = Field(default=None, ge=40, le=260)
    weight_kg: float | None = Field(default=None, ge=10, le=350)
    emergency_note: str | None = Field(default=None, max_length=300)


class ExtractedEntityUpdate(BaseModel):
    category: str | None = Field(default=None, pattern="^(condition|medication|allergy|lab_result|observation|event)$")
    name: str | None = Field(default=None, min_length=1, max_length=160)
    value: str | None = Field(default=None, max_length=240)
    unit: str | None = Field(default=None, max_length=40)
    reference_range: str | None = Field(default=None, max_length=80)
    flag: str | None = Field(default=None, max_length=40)
    user_verified: bool = True


class ExtractedEntityCreate(BaseModel):
    document_id: str | None = None
    category: str = Field(..., pattern="^(condition|medication|allergy|lab_result|observation|event)$")
    name: str = Field(..., min_length=1, max_length=160)
    value: str | None = None
    unit: str | None = None
    reference_range: str | None = None
    flag: str | None = None
    observed_date: str | None = None


class AssistantQuestionRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000)


class HealthEventCreate(BaseModel):
    event_type: str = Field(default="symptom", pattern="^(symptom|checkup|medication_note|observation)$")
    title: str = Field(..., min_length=2, max_length=160)
    description: str = Field(..., min_length=2, max_length=1000)
    event_date: str = Field(..., min_length=8, max_length=20)
    severity: str = Field(default="info", pattern="^(info|attention)$")


class AccessRequestCreate(BaseModel):
    medisync_id: str = Field(..., min_length=6, max_length=40)
    purpose: str = Field(..., min_length=5, max_length=400)
    scopes: list[str] = Field(default_factory=lambda: ["records", "wearables", "baseline", "timeline", "ai_summary"])


class ConsentRespondRequest(BaseModel):
    request_id: str
    decision: str = Field(..., pattern="^(approve|deny)$")
    scopes: list[str] | None = None
    expires_days: int = Field(default=30, ge=1, le=365)


class ProfessionalVerifyRequest(BaseModel):
    decision: str = Field(..., pattern="^(verified|rejected)$")


class UserStatusRequest(BaseModel):
    status: str = Field(..., pattern="^(active|suspended)$")


# ---------------------------------------------------------------------------
# System & Auth Endpoints
# ---------------------------------------------------------------------------
@app.get("/api/health")
def health_check() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "MediSync API",
        "auth_mode": "supabase" if HAS_SUPABASE else "local_demo_jwt",
        "demo_mode": DEMO_MODE,
        "groq_llm_enabled": HAS_GROQ,
        "timestamp": utcnow_iso(),
    }


@app.get("/api/auth/demo-accounts")
def get_demo_accounts() -> dict[str, Any]:
    return {
        "demo_mode": DEMO_MODE,
        "notice": "Clearly labelled synthetic demonstration accounts for evaluation.",
        "accounts": [
            {
                "role": "patient",
                "label": "Synthetic Demo Patient",
                "name": "Aarav Sharma (Synthetic Demo)",
                "email": "aarav.demo@medisync.local",
                "medisync_id": "MS-2026-482910",
                "password": "PatientDemo@2026",
            },
            {
                "role": "professional",
                "label": "Verified Demo Clinician",
                "name": "Dr. Kavita Rao (Demo Clinician)",
                "email": "dr.kavita@medisync.local",
                "password": "DoctorDemo@2026",
            },
            {
                "role": "admin",
                "label": "Platform Administrator",
                "name": "Meera Nair (Platform Admin)",
                "email": "admin@medisync.local",
                "password": "AdminDemo@2026",
            },
        ],
    }


@app.post("/api/auth/register", status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> dict[str, Any]:
    if "@" not in payload.email or "." not in payload.email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    if get_user_by_email(payload.email):
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    if payload.role == "professional":
        if not payload.specialty or not payload.registration_number:
            raise HTTPException(
                status_code=400,
                detail="Healthcare professionals must provide their specialty and medical registration number.",
            )

    user_id = str(uuid.uuid4())
    now = utcnow_iso()
    ms_id = None

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO user_profiles (id, email, password_hash, full_name, role, status, is_synthetic, created_at)
            VALUES (?, ?, ?, ?, ?, 'active', 0, ?)
            """,
            (user_id, payload.email.strip().lower(), hash_password(payload.password), payload.full_name.strip(), payload.role, now),
        )

        if payload.role == "patient":
            ms_id, qr_token = generate_medisync_id(conn)
            conn.execute(
                """
                INSERT INTO patient_profiles (user_id, age, sex, blood_group, updated_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (user_id, payload.age, payload.sex, payload.blood_group, now),
            )
            conn.execute(
                """
                INSERT INTO medisync_ids (id, patient_user_id, medisync_id, qr_token, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), user_id, ms_id, qr_token, now),
            )
            default_device_connectors(user_id, conn, imported_count=0)
        else:
            conn.execute(
                """
                INSERT INTO professional_profiles (user_id, specialty, registration_number, facility_name, verification_status)
                VALUES (?, ?, ?, ?, 'pending')
                """,
                (
                    user_id,
                    payload.specialty.strip(),
                    payload.registration_number.strip(),
                    (payload.facility_name or "Independent Practice").strip(),
                ),
            )

    log_audit(user_id, payload.role, "USER_REGISTERED", "user", user_id, {"medisync_id": ms_id})
    token = create_access_token(user_id, payload.email.strip().lower(), payload.role, payload.full_name.strip())
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user_id,
            "email": payload.email.strip().lower(),
            "full_name": payload.full_name.strip(),
            "role": payload.role,
            "medisync_id": ms_id,
        },
    }


@app.post("/api/auth/login")
def login(payload: LoginRequest) -> dict[str, Any]:
    user = get_user_by_email(payload.email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")
    if user["status"] != "active":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is suspended. Contact platform administration.")

    extra: dict[str, Any] = {}
    with get_conn() as conn:
        if user["role"] == "patient":
            ms = conn.execute("SELECT medisync_id FROM medisync_ids WHERE patient_user_id = ?", (user["id"],)).fetchone()
            extra["medisync_id"] = ms["medisync_id"] if ms else None
        elif user["role"] == "professional":
            pro = conn.execute("SELECT verification_status, specialty FROM professional_profiles WHERE user_id = ?", (user["id"],)).fetchone()
            if pro:
                extra["verification_status"] = pro["verification_status"]
                extra["specialty"] = pro["specialty"]

    log_audit(user["id"], user["role"], "USER_LOGIN", "user", user["id"])
    token = create_access_token(user["id"], user["email"], user["role"], user["full_name"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "demo_mode": DEMO_MODE,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "full_name": user["full_name"],
            "role": user["role"],
            "is_synthetic": bool(user["is_synthetic"]),
            **extra,
        },
    }


@app.get("/api/auth/me")
def get_me(user: dict = Depends(get_current_user)) -> dict[str, Any]:
    with get_conn() as conn:
        extra: dict[str, Any] = {}
        if user["role"] == "patient":
            ms = conn.execute("SELECT medisync_id FROM medisync_ids WHERE patient_user_id = ?", (user["id"],)).fetchone()
            extra["medisync_id"] = ms["medisync_id"] if ms else None
        elif user["role"] == "professional":
            pro = conn.execute("SELECT * FROM professional_profiles WHERE user_id = ?", (user["id"],)).fetchone()
            extra["professional"] = dict(pro) if pro else None
    return {
        "id": user["id"],
        "email": user["email"],
        "full_name": user["full_name"],
        "role": user["role"],
        "status": user["status"],
        "is_synthetic": bool(user["is_synthetic"]),
        **extra,
    }


# ---------------------------------------------------------------------------
# Sample Data Downloads (Clearly Labelled Synthetic)
# ---------------------------------------------------------------------------
@app.get("/api/samples/{sample_name}")
def download_sample_file(sample_name: str):
    mapping = {
        "lab-report.pdf": ("synthetic_lab_report.pdf", "application/pdf"),
        "prescription.pdf": ("synthetic_prescription.pdf", "application/pdf"),
        "wearable-30d.csv": ("synthetic_wearable_30d.csv", "text/csv"),
        "wearable-7d.json": ("synthetic_wearable_7d_update.json", "application/json"),
    }
    if sample_name not in mapping:
        raise HTTPException(status_code=404, detail="Sample file not found.")
    filename, media_type = mapping[sample_name]
    path = SAMPLE_DIR / filename
    if not path.exists():
        ensure_sample_files()
    return FileResponse(path=path, filename=filename, media_type=media_type)


# ---------------------------------------------------------------------------
# Patient Dashboard Endpoints
# ---------------------------------------------------------------------------
def _get_patient_medisync_row(patient_user_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM medisync_ids WHERE patient_user_id = ?", (patient_user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="MediSync ID not found for patient.")
        return dict(row)


@app.get("/api/patient/overview")
def patient_overview(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    ms_row = _get_patient_medisync_row(pid)
    ms_id = ms_row["medisync_id"]

    with get_conn() as conn:
        profile = conn.execute("SELECT * FROM patient_profiles WHERE user_id = ?", (pid,)).fetchone()
        latest_obs = conn.execute(
            "SELECT * FROM wearable_observations WHERE patient_user_id = ? ORDER BY observed_at DESC LIMIT 1",
            (pid,),
        ).fetchone()
        obs_count = conn.execute(
            "SELECT COUNT(*) AS c FROM wearable_observations WHERE patient_user_id = ?", (pid,)
        ).fetchone()["c"]
        doc_count = conn.execute(
            "SELECT COUNT(*) AS c FROM medical_documents WHERE patient_user_id = ?", (pid,)
        ).fetchone()["c"]
        conditions = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, value, user_verified FROM extracted_medical_info WHERE patient_user_id = ? AND category = 'condition'",
                (pid,),
            ).fetchall()
        ]
        medications = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, value, user_verified FROM extracted_medical_info WHERE patient_user_id = ? AND category = 'medication'",
                (pid,),
            ).fetchall()
        ]
        allergies = [
            dict(r)
            for r in conn.execute(
                "SELECT id, name, value, user_verified FROM extracted_medical_info WHERE patient_user_id = ? AND category = 'allergy'",
                (pid,),
            ).fetchall()
        ]
        devices = [
            dict(r)
            for r in conn.execute("SELECT * FROM device_connections WHERE patient_user_id = ?", (pid,)).fetchall()
        ]
        insights = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM health_insights WHERE patient_user_id = ? ORDER BY created_at DESC LIMIT 5", (pid,)
            ).fetchall()
        ]
        pending_requests = conn.execute(
            "SELECT COUNT(*) AS c FROM access_requests WHERE patient_user_id = ? AND status = 'pending'", (pid,)
        ).fetchone()["c"]
        active_consents = conn.execute(
            "SELECT COUNT(*) AS c FROM consent_records WHERE patient_user_id = ? AND status = 'active'", (pid,)
        ).fetchone()["c"]

    for ins in insights:
        ins["evidence"] = json.loads(ins.pop("evidence_json", "{}"))

    return {
        "patient": {
            "id": pid,
            "full_name": user["full_name"],
            "email": user["email"],
            "is_synthetic": bool(user["is_synthetic"]),
            "medisync_id": ms_id,
            "qr_payload": build_privacy_safe_qr_payload(ms_id),
            "qr_data_uri": generate_qr_data_uri(ms_id),
            "qr_privacy_note": "QR encodes only your opaque MediSync ID. Zero name, phone, DOB, or medical data is inside the QR.",
            "profile": dict(profile) if profile else {},
        },
        "counts": {
            "documents": doc_count,
            "wearable_days": obs_count,
            "conditions": len(conditions),
            "medications": len(medications),
            "allergies": len(allergies),
            "pending_access_requests": pending_requests,
            "active_consents": active_consents,
        },
        "summary": {
            "conditions": conditions,
            "medications": medications,
            "allergies": allergies,
        },
        "latest_observation": dict(latest_obs) if latest_obs else None,
        "devices": devices,
        "insights": insights,
    }


@app.get("/api/patient/qr.png")
def patient_qr_png(user: dict = Depends(require_role("patient"))):
    ms_row = _get_patient_medisync_row(user["id"])
    png = generate_qr_png_bytes(ms_row["medisync_id"])
    return Response(content=png, media_type="image/png")


@app.put("/api/patient/profile")
def update_patient_profile(payload: PatientProfileUpdate, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    now = utcnow_iso()
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE patient_profiles
            SET age = COALESCE(?, age),
                sex = COALESCE(?, sex),
                blood_group = COALESCE(?, blood_group),
                height_cm = COALESCE(?, height_cm),
                weight_kg = COALESCE(?, weight_kg),
                emergency_note = COALESCE(?, emergency_note),
                updated_at = ?
            WHERE user_id = ?
            """,
            (payload.age, payload.sex, payload.blood_group, payload.height_cm, payload.weight_kg, payload.emergency_note, now, user["id"]),
        )
        updated = dict(conn.execute("SELECT * FROM patient_profiles WHERE user_id = ?", (user["id"],)).fetchone())
    log_audit(user["id"], "patient", "UPDATE_PROFILE", "patient_profile", user["id"])
    return {"profile": updated}


@app.get("/api/patient/records")
def get_patient_records(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    with get_conn() as conn:
        docs = [
            dict(r)
            for r in conn.execute(
                "SELECT id, title, document_type, filename, document_date, extraction_status, is_synthetic, uploaded_at FROM medical_documents WHERE patient_user_id = ? ORDER BY uploaded_at DESC",
                (pid,),
            ).fetchall()
        ]
        extracted = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM extracted_medical_info WHERE patient_user_id = ? ORDER BY updated_at DESC",
                (pid,),
            ).fetchall()
        ]
    return {"documents": docs, "extracted": extracted}


@app.get("/api/patient/records/{doc_id}/raw")
def get_record_raw_text(doc_id: str, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    with get_conn() as conn:
        doc = conn.execute(
            "SELECT id, title, filename, document_type, document_date, extraction_status, raw_text FROM medical_documents WHERE id = ? AND patient_user_id = ?",
            (doc_id, user["id"]),
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Medical document not found.")
    return dict(doc)


@app.post("/api/patient/records/upload", status_code=status.HTTP_201_CREATED)
async def upload_medical_record(
    file: UploadFile = File(...),
    title: str = Form(default=""),
    document_type: str = Form(default="lab_report"),
    document_date: str = Form(default=""),
    user: dict = Depends(require_role("patient")),
) -> dict[str, Any]:
    filename = Path(file.filename or "report.pdf").name
    if not (filename.lower().endswith(".pdf") or filename.lower().endswith(".txt")):
        raise HTTPException(status_code=400, detail="Please upload a PDF (.pdf) or text (.txt) medical document.")

    if document_type not in {"lab_report", "prescription", "checkup", "discharge_summary", "other"}:
        document_type = "other"

    raw_bytes = await file.read()
    if not raw_bytes or len(raw_bytes) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File must be non-empty and under 15 MB.")

    pid = user["id"]
    doc_id = str(uuid.uuid4())
    patient_dir = UPLOAD_DIR / pid
    patient_dir.mkdir(parents=True, exist_ok=True)
    safe_name = f"{doc_id[:8]}_{re.sub(r'[^A-Za-z0-9._-]', '_', filename)}"
    dest = patient_dir / safe_name
    dest.write_bytes(raw_bytes)

    try:
        full_text, pages = extract_text_from_pdf_bytes(raw_bytes, filename)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not parse PDF file: {exc}") from exc

    doc_date = document_date.strip() or utcnow_iso()[:10]
    entities = extract_medical_entities(full_text, filename, doc_date, pages=pages)
    extraction_status = "extracted" if entities else ("needs_review" if full_text.strip() else "failed")
    now = utcnow_iso()

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO medical_documents
            (id, patient_user_id, title, document_type, filename, storage_path, document_date, extraction_status, raw_text, is_synthetic, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (doc_id, pid, title.strip() or filename, document_type, filename, str(dest), doc_date, extraction_status, full_text or "[No extractable text found; image-only PDF requires manual entry]", now),
        )
        inserted_entities = []
        for ent in entities:
            eid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO extracted_medical_info
                (id, document_id, patient_user_id, category, name, value, unit, reference_range, flag, observed_date, source_reference, confidence, user_verified, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    eid,
                    doc_id,
                    pid,
                    ent["category"],
                    ent["name"],
                    ent.get("value"),
                    ent.get("unit"),
                    ent.get("reference_range"),
                    ent.get("flag"),
                    ent.get("observed_date") or doc_date,
                    ent.get("source_reference"),
                    ent.get("confidence", 0.85),
                    now,
                ),
            )
            inserted_entities.append({"id": eid, **ent})

    recompute_patient_intelligence(pid)
    log_audit(pid, "patient", "UPLOAD_MEDICAL_RECORD", "medical_document", doc_id, {"filename": filename, "entities_extracted": len(inserted_entities)})

    return {
        "document": {
            "id": doc_id,
            "title": title.strip() or filename,
            "document_type": document_type,
            "filename": filename,
            "document_date": doc_date,
            "extraction_status": extraction_status,
            "uploaded_at": now,
        },
        "extracted_count": len(inserted_entities),
        "extracted": inserted_entities,
        "raw_text_preview": full_text[:800],
    }


@app.post("/api/patient/records/{doc_id}/reextract")
def reextract_medical_record(doc_id: str, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    now = utcnow_iso()
    with get_conn() as conn:
        doc = conn.execute(
            "SELECT * FROM medical_documents WHERE id = ? AND patient_user_id = ?", (doc_id, pid)
        ).fetchone()
        if not doc:
            raise HTTPException(status_code=404, detail="Medical document not found.")
        full_text = doc["raw_text"] or ""
        entities = extract_medical_entities(full_text, doc["filename"], doc["document_date"], use_llm=True)
        conn.execute("DELETE FROM extracted_medical_info WHERE document_id = ? AND patient_user_id = ?", (doc_id, pid))
        inserted = []
        for ent in entities:
            eid = str(uuid.uuid4())
            conn.execute(
                """
                INSERT INTO extracted_medical_info
                (id, document_id, patient_user_id, category, name, value, unit, reference_range, flag, observed_date, source_reference, confidence, user_verified, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
                """,
                (
                    eid,
                    doc_id,
                    pid,
                    ent["category"],
                    ent["name"],
                    ent.get("value"),
                    ent.get("unit"),
                    ent.get("reference_range"),
                    ent.get("flag"),
                    ent.get("observed_date") or doc["document_date"],
                    ent.get("source_reference"),
                    ent.get("confidence", 0.85),
                    now,
                ),
            )
            inserted.append({"id": eid, **ent})
        conn.execute("UPDATE medical_documents SET extraction_status = 'extracted' WHERE id = ?", (doc_id,))

    recompute_patient_intelligence(pid)
    log_audit(pid, "patient", "REEXTRACT_MEDICAL_RECORD", "medical_document", doc_id, {"entities_extracted": len(inserted)})
    return {"document_id": doc_id, "extracted_count": len(inserted), "extracted": inserted}


@app.put("/api/patient/extracted/{item_id}")
def update_extracted_entity(item_id: str, payload: ExtractedEntityUpdate, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    now = utcnow_iso()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM extracted_medical_info WHERE id = ? AND patient_user_id = ?", (item_id, user["id"])
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Extracted item not found.")

        conn.execute(
            """
            UPDATE extracted_medical_info
            SET category = COALESCE(?, category),
                name = COALESCE(?, name),
                value = COALESCE(?, value),
                unit = COALESCE(?, unit),
                reference_range = COALESCE(?, reference_range),
                flag = COALESCE(?, flag),
                user_verified = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                payload.category,
                payload.name,
                payload.value,
                payload.unit,
                payload.reference_range,
                payload.flag,
                1 if payload.user_verified else 0,
                now,
                item_id,
            ),
        )
        conn.execute("UPDATE medical_documents SET extraction_status = 'reviewed' WHERE id = ?", (row["document_id"],))
        updated = dict(conn.execute("SELECT * FROM extracted_medical_info WHERE id = ?", (item_id,)).fetchone())

    log_audit(user["id"], "patient", "REVIEW_EXTRACTED_ENTITY", "extracted_medical_info", item_id)
    return {"item": updated}


@app.post("/api/patient/extracted", status_code=status.HTTP_201_CREATED)
def create_extracted_entity(payload: ExtractedEntityCreate, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    now = utcnow_iso()
    with get_conn() as conn:
        doc_id = payload.document_id
        if not doc_id:
            existing_doc = conn.execute(
                "SELECT id FROM medical_documents WHERE patient_user_id = ? ORDER BY uploaded_at DESC LIMIT 1", (pid,)
            ).fetchone()
            if existing_doc:
                doc_id = existing_doc["id"]
            else:
                doc_id = str(uuid.uuid4())
                conn.execute(
                    """
                    INSERT INTO medical_documents (id, patient_user_id, title, document_type, filename, storage_path, document_date, extraction_status, raw_text, is_synthetic, uploaded_at)
                    VALUES (?, ?, 'Patient Self-Entered Medical Summary', 'other', 'self_entered.txt', 'manual', ?, 'reviewed', 'Manually entered by patient.', 0, ?)
                    """,
                    (doc_id, pid, now[:10], now),
                )

        eid = str(uuid.uuid4())
        conn.execute(
            """
            INSERT INTO extracted_medical_info
            (id, document_id, patient_user_id, category, name, value, unit, reference_range, flag, observed_date, source_reference, confidence, user_verified, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Patient-entered / verified', 1.0, 1, ?)
            """,
            (
                eid,
                doc_id,
                pid,
                payload.category,
                payload.name.strip(),
                payload.value,
                payload.unit,
                payload.reference_range,
                payload.flag or "Patient Verified",
                payload.observed_date or now[:10],
                now,
            ),
        )
        created = dict(conn.execute("SELECT * FROM extracted_medical_info WHERE id = ?", (eid,)).fetchone())
    log_audit(pid, "patient", "ADD_EXTRACTED_ENTITY", "extracted_medical_info", eid)
    return {"item": created}


@app.get("/api/patient/wearables")
def get_wearables(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    with get_conn() as conn:
        connectors = [
            dict(r) for r in conn.execute("SELECT * FROM device_connections WHERE patient_user_id = ?", (pid,)).fetchall()
        ]
        observations = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM wearable_observations WHERE patient_user_id = ? ORDER BY observed_at ASC", (pid,)
            ).fetchall()
        ]
    return {"connectors": connectors, "observations": observations}


def _store_wearable_rows(pid: str, rows: list[dict[str, Any]], connector: str, is_synthetic: bool) -> dict[str, Any]:
    now = utcnow_iso()
    with get_conn() as conn:
        for row in rows:
            conn.execute(
                """
                INSERT INTO wearable_observations
                (id, patient_user_id, source_connector, observed_at, resting_hr, avg_hr, spo2, sleep_hours, deep_sleep_hours, steps, active_minutes, hrv_ms, activity_context, quality_score, is_synthetic)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    pid,
                    connector,
                    row["observed_at"],
                    row.get("resting_hr"),
                    row.get("avg_hr"),
                    row.get("spo2"),
                    row.get("sleep_hours"),
                    row.get("deep_sleep_hours"),
                    row.get("steps"),
                    row.get("active_minutes"),
                    row.get("hrv_ms"),
                    row.get("activity_context", "unspecified"),
                    row.get("quality_score", 0.90),
                    1 if is_synthetic else 0,
                ),
            )
        conn.execute(
            """
            UPDATE device_connections
            SET status = 'active_import',
                last_sync_at = ?,
                records_imported = records_imported + ?
            WHERE patient_user_id = ? AND connector_key = ?
            """,
            (now, len(rows), pid, connector),
        )
    intel = recompute_patient_intelligence(pid)
    log_audit(pid, "patient", "IMPORT_WEARABLE_DATA", "wearable", pid, {"connector": connector, "count": len(rows), "is_synthetic": is_synthetic})
    return {"imported_count": len(rows), "connector": connector, "intelligence": intel}


@app.post("/api/patient/wearables/import")
async def import_wearables_file(file: UploadFile = File(...), user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    raw_bytes = await file.read()
    try:
        rows, connector = parse_wearable_file(raw_bytes, file.filename or "readings.csv")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _store_wearable_rows(user["id"], rows, connector, is_synthetic=False)


@app.post("/api/patient/wearables/import-sample")
def import_sample_wearables(
    format_type: str = Query(default="json", pattern="^(csv|json)$"),
    user: dict = Depends(require_role("patient")),
) -> dict[str, Any]:
    paths = ensure_sample_files()
    target = paths["wearable_json"] if format_type == "json" else paths["wearable_csv"]
    rows, connector = parse_wearable_file(target.read_bytes(), target.name)
    return _store_wearable_rows(user["id"], rows, connector, is_synthetic=True)


@app.get("/api/patient/baseline")
def get_patient_baseline(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    with get_conn() as conn:
        baselines = [
            dict(r) for r in conn.execute("SELECT * FROM personal_baselines WHERE patient_user_id = ?", (pid,)).fetchall()
        ]
        insights = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM health_insights WHERE patient_user_id = ? ORDER BY created_at DESC", (pid,)
            ).fetchall()
        ]
        obs_bounds = conn.execute(
            "SELECT MIN(observed_at) AS first_obs, MAX(observed_at) AS last_obs, COUNT(*) AS total_days FROM wearable_observations WHERE patient_user_id = ?",
            (pid,),
        ).fetchone()
    for ins in insights:
        ins["evidence"] = json.loads(ins.pop("evidence_json", "{}"))
    return {
        "observation_period": dict(obs_bounds) if obs_bounds else {},
        "baselines": baselines,
        "insights": insights,
        "methodology_note": (
            "Personal baselines are computed strictly from your own historical observations (not population averages). "
            "At least 7 days of observations are required for moderate confidence and 14+ days for high confidence. "
            "Heart rate increases during documented physical activity are contextualized rather than flagged."
        ),
    }


@app.post("/api/patient/assistant/ask")
def ask_assistant(payload: AssistantQuestionRequest, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    answer = answer_health_question(pid, payload.question)
    now = utcnow_iso()
    conv_id = str(uuid.uuid4())
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO ai_conversations (id, patient_user_id, actor_user_id, question, answer_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (conv_id, pid, pid, payload.question.strip(), json.dumps(answer), now),
        )
    log_audit(pid, "patient", "ASK_AI_ASSISTANT", "ai_conversation", conv_id)
    return {"id": conv_id, "question": payload.question.strip(), "answer": answer, "created_at": now}


@app.get("/api/patient/assistant/history")
def assistant_history(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    with get_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM ai_conversations WHERE patient_user_id = ? ORDER BY created_at ASC", (user["id"],)
            ).fetchall()
        ]
    for r in rows:
        r["answer"] = json.loads(r.pop("answer_json", "{}"))
    return {"conversations": rows}


def _build_patient_timeline(pid: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    with get_conn() as conn:
        for d in conn.execute(
            "SELECT id, title, document_type, filename, document_date, extraction_status FROM medical_documents WHERE patient_user_id = ?",
            (pid,),
        ).fetchall():
            items.append({
                "id": f"doc-{d['id']}",
                "date": d["document_date"] or "",
                "category": d["document_type"],
                "title": d["title"],
                "description": f"Source file: {d['filename']} (Status: {d['extraction_status']})",
                "badge": "Medical Document",
            })
        for ev in conn.execute("SELECT * FROM health_events WHERE patient_user_id = ?", (pid,)).fetchall():
            items.append({
                "id": f"ev-{ev['id']}",
                "date": ev["event_date"],
                "category": ev["event_type"],
                "title": ev["title"],
                "description": ev["description"],
                "badge": "Patient Event",
            })
        for ins in conn.execute("SELECT * FROM health_insights WHERE patient_user_id = ?", (pid,)).fetchall():
            ev_data = json.loads(ins["evidence_json"] or "{}")
            dt = ev_data.get("date") or (ev_data.get("days_flagged") or [ins["created_at"][:10]])[-1]
            items.append({
                "id": f"ins-{ins['id']}",
                "date": dt,
                "category": "deviation" if ins["severity"] != "info" else "wearable_context",
                "title": ins["title"],
                "description": ins["explanation"],
                "badge": "Baseline Intelligence",
            })
        wear_count = conn.execute(
            "SELECT COUNT(*) AS c, MIN(observed_at) AS min_d, MAX(observed_at) AS max_d FROM wearable_observations WHERE patient_user_id = ?",
            (pid,),
        ).fetchone()
        if wear_count and wear_count["c"] > 0:
            items.append({
                "id": "wear-summary",
                "date": (wear_count["max_d"] or "")[:10],
                "category": "wearable",
                "title": f"Wearable Synchronization ({wear_count['c']} daily observations)",
                "description": f"Observation window from {(wear_count['min_d'] or '')[:10]} to {(wear_count['max_d'] or '')[:10]}.",
                "badge": "Wearable Stream",
            })

    items.sort(key=lambda x: x["date"], reverse=True)
    return items


@app.get("/api/patient/timeline")
def get_patient_timeline(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    return {"timeline": _build_patient_timeline(user["id"])}


@app.post("/api/patient/events", status_code=status.HTTP_201_CREATED)
def add_health_event(payload: HealthEventCreate, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    ev_id = str(uuid.uuid4())
    now = utcnow_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO health_events (id, patient_user_id, event_type, title, description, event_date, severity, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (ev_id, user["id"], payload.event_type, payload.title.strip(), payload.description.strip(), payload.event_date, payload.severity, now),
        )
        ev = dict(conn.execute("SELECT * FROM health_events WHERE id = ?", (ev_id,)).fetchone())
    log_audit(user["id"], "patient", "ADD_HEALTH_EVENT", "health_event", ev_id)
    return {"event": ev}


@app.get("/api/patient/consent")
def get_patient_consent(user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    with get_conn() as conn:
        requests = [
            dict(r)
            for r in conn.execute(
                """
                SELECT ar.*, u.full_name AS professional_name, u.email AS professional_email,
                       pp.specialty, pp.registration_number, pp.facility_name, pp.verification_status
                FROM access_requests ar
                JOIN user_profiles u ON u.id = ar.professional_user_id
                LEFT JOIN professional_profiles pp ON pp.user_id = ar.professional_user_id
                WHERE ar.patient_user_id = ?
                ORDER BY ar.created_at DESC
                """,
                (pid,),
            ).fetchall()
        ]
        consents = [
            dict(r)
            for r in conn.execute(
                """
                SELECT cr.*, u.full_name AS professional_name, pp.specialty, pp.facility_name
                FROM consent_records cr
                JOIN user_profiles u ON u.id = cr.professional_user_id
                LEFT JOIN professional_profiles pp ON pp.user_id = cr.professional_user_id
                WHERE cr.patient_user_id = ?
                ORDER BY cr.granted_at DESC
                """,
                (pid,),
            ).fetchall()
        ]
        audits = [
            dict(r)
            for r in conn.execute(
                """
                SELECT al.*, u.full_name AS actor_name
                FROM audit_logs al
                LEFT JOIN user_profiles u ON u.id = al.actor_user_id
                WHERE al.target_id = ? OR al.actor_user_id = ?
                ORDER BY al.created_at DESC LIMIT 30
                """,
                (pid, pid),
            ).fetchall()
        ]
    for req in requests:
        req["requested_scopes"] = json.loads(req["requested_scopes"])
    for c in consents:
        c["scopes"] = json.loads(c["scopes"])
    for a in audits:
        a["details"] = json.loads(a.pop("details_json", "{}"))
    return {"requests": requests, "consents": consents, "access_history": audits}


@app.post("/api/patient/consent/respond")
def respond_consent(payload: ConsentRespondRequest, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    now = utcnow_iso()
    with get_conn() as conn:
        req = conn.execute(
            "SELECT * FROM access_requests WHERE id = ? AND patient_user_id = ?", (payload.request_id, pid)
        ).fetchone()
        if not req:
            raise HTTPException(status_code=404, detail="Access request not found.")
        if req["status"] != "pending":
            raise HTTPException(status_code=400, detail="This request has already been processed.")

        new_status = "approved" if payload.decision == "approve" else "denied"
        conn.execute(
            "UPDATE access_requests SET status = ?, decided_at = ? WHERE id = ?",
            (new_status, now, payload.request_id),
        )

        consent_id = None
        if payload.decision == "approve":
            scopes = payload.scopes or json.loads(req["requested_scopes"])
            consent_id = str(uuid.uuid4())
            expires_at = (datetime.now(timezone.utc) + timedelta(days=payload.expires_days)).strftime("%Y-%m-%dT%H:%M:%SZ")
            # Supersede any older active consent for the same professional
            conn.execute(
                "UPDATE consent_records SET status = 'revoked', revoked_at = ? WHERE patient_user_id = ? AND professional_user_id = ? AND status = 'active'",
                (now, pid, req["professional_user_id"]),
            )
            conn.execute(
                """
                INSERT INTO consent_records (id, patient_user_id, professional_user_id, scopes, status, granted_at, expires_at)
                VALUES (?, ?, ?, ?, 'active', ?, ?)
                """,
                (consent_id, pid, req["professional_user_id"], json.dumps(scopes), now, expires_at),
            )

    log_audit(
        pid,
        "patient",
        "CONSENT_APPROVED" if payload.decision == "approve" else "CONSENT_DENIED",
        "patient",
        pid,
        {"professional_user_id": req["professional_user_id"], "consent_id": consent_id},
    )
    return {"status": new_status, "consent_id": consent_id}


@app.post("/api/patient/consent/{consent_id}/revoke")
def revoke_consent(consent_id: str, user: dict = Depends(require_role("patient"))) -> dict[str, Any]:
    pid = user["id"]
    now = utcnow_iso()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM consent_records WHERE id = ? AND patient_user_id = ?", (consent_id, pid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Consent record not found.")
        conn.execute(
            "UPDATE consent_records SET status = 'revoked', revoked_at = ? WHERE id = ?", (now, consent_id)
        )
    log_audit(pid, "patient", "CONSENT_REVOKED", "patient", pid, {"consent_id": consent_id, "professional_user_id": row["professional_user_id"]})
    return {"status": "revoked", "consent_id": consent_id}


# ---------------------------------------------------------------------------
# Healthcare Professional Endpoints (Strict Consent & Verification Gated)
# ---------------------------------------------------------------------------
def _get_pro_profile(pro_user_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM professional_profiles WHERE user_id = ?", (pro_user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Professional profile not found.")
        return dict(row)


def _resolve_medisync_identifier(raw_query: str) -> dict | None:
    cleaned = raw_query.strip()
    if cleaned.startswith("medisync://lookup/"):
        cleaned = cleaned.split("medisync://lookup/", 1)[1].strip()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM medisync_ids WHERE upper(medisync_id) = upper(?) OR qr_token = ?",
            (cleaned, cleaned),
        ).fetchone()
        return dict(row) if row else None


@app.get("/api/professional/profile")
def professional_profile(user: dict = Depends(require_role("professional"))) -> dict[str, Any]:
    pro = _get_pro_profile(user["id"])
    with get_conn() as conn:
        patients = [
            dict(r)
            for r in conn.execute(
                """
                SELECT m.medisync_id, u.full_name, cr.status AS consent_status, cr.scopes, cr.granted_at, cr.expires_at
                FROM consent_records cr
                JOIN user_profiles u ON u.id = cr.patient_user_id
                JOIN medisync_ids m ON m.patient_user_id = cr.patient_user_id
                WHERE cr.professional_user_id = ?
                ORDER BY cr.granted_at DESC
                """,
                (user["id"],),
            ).fetchall()
        ]
        requests = [
            dict(r)
            for r in conn.execute(
                """
                SELECT ar.id, ar.status, ar.purpose, ar.created_at, m.medisync_id
                FROM access_requests ar
                JOIN medisync_ids m ON m.patient_user_id = ar.patient_user_id
                WHERE ar.professional_user_id = ?
                ORDER BY ar.created_at DESC
                """,
                (user["id"],),
            ).fetchall()
        ]
    for p in patients:
        p["scopes"] = json.loads(p["scopes"])
    return {
        "user": {
            "id": user["id"],
            "full_name": user["full_name"],
            "email": user["email"],
            "is_synthetic": bool(user["is_synthetic"]),
        },
        "professional": pro,
        "consented_patients": patients,
        "access_requests": requests,
    }


@app.get("/api/professional/lookup")
def professional_lookup(query: str = Query(..., min_length=4), user: dict = Depends(require_role("professional"))) -> dict[str, Any]:
    pro = _get_pro_profile(user["id"])
    ms = _resolve_medisync_identifier(query)
    if not ms:
        raise HTTPException(status_code=404, detail="No patient found for that MediSync ID or QR token.")

    pid = ms["patient_user_id"]
    with get_conn() as conn:
        consent = conn.execute(
            "SELECT id, scopes, status, granted_at, expires_at FROM consent_records WHERE patient_user_id = ? AND professional_user_id = ? AND status = 'active' ORDER BY granted_at DESC LIMIT 1",
            (pid, user["id"]),
        ).fetchone()
        pending_req = conn.execute(
            "SELECT id, status, created_at FROM access_requests WHERE patient_user_id = ? AND professional_user_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1",
            (pid, user["id"]),
        ).fetchone()

    log_audit(user["id"], "professional", "PATIENT_ID_LOOKUP", "medisync_id", ms["medisync_id"])

    # Notice: NO patient name, age, conditions, or reports are returned unless consent is active!
    return {
        "medisync_id": ms["medisync_id"],
        "professional_verified": pro["verification_status"] == "verified",
        "verification_status": pro["verification_status"],
        "consent_active": bool(consent),
        "consented_scopes": json.loads(consent["scopes"]) if consent else [],
        "pending_request": dict(pending_req) if pending_req else None,
        "privacy_notice": "Patient identity and clinical records remain protected until explicit patient consent is granted.",
    }


@app.post("/api/professional/access-requests", status_code=status.HTTP_201_CREATED)
def professional_request_access(payload: AccessRequestCreate, user: dict = Depends(require_role("professional"))) -> dict[str, Any]:
    pro = _get_pro_profile(user["id"])
    if pro["verification_status"] != "verified":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your healthcare professional credentials must be verified by an admin before requesting patient access.",
        )

    ms = _resolve_medisync_identifier(payload.medisync_id)
    if not ms:
        raise HTTPException(status_code=404, detail="MediSync ID not found.")

    pid = ms["patient_user_id"]
    valid_scopes = [s for s in payload.scopes if s in {"records", "wearables", "baseline", "timeline", "ai_summary"}]
    if not valid_scopes:
        valid_scopes = ["records", "wearables", "baseline", "timeline", "ai_summary"]

    req_id = str(uuid.uuid4())
    now = utcnow_iso()
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO access_requests (id, patient_user_id, professional_user_id, purpose, requested_scopes, status, created_at)
            VALUES (?, ?, ?, ?, ?, 'pending', ?)
            """,
            (req_id, pid, user["id"], payload.purpose.strip(), json.dumps(valid_scopes), now),
        )
    log_audit(user["id"], "professional", "REQUEST_PATIENT_ACCESS", "patient", pid, {"medisync_id": ms["medisync_id"], "scopes": valid_scopes})
    return {"request_id": req_id, "medisync_id": ms["medisync_id"], "status": "pending", "scopes": valid_scopes}


@app.get("/api/professional/patients/{medisync_id}")
def professional_view_patient(medisync_id: str, user: dict = Depends(require_role("professional"))) -> dict[str, Any]:
    pro = _get_pro_profile(user["id"])
    if pro["verification_status"] != "verified":
        raise HTTPException(status_code=403, detail="Professional verification required.")

    ms = _resolve_medisync_identifier(medisync_id)
    if not ms:
        raise HTTPException(status_code=404, detail="MediSync ID not found.")

    pid = ms["patient_user_id"]
    now = utcnow_iso()
    with get_conn() as conn:
        consent = conn.execute(
            """
            SELECT * FROM consent_records
            WHERE patient_user_id = ? AND professional_user_id = ? AND status = 'active'
            ORDER BY granted_at DESC LIMIT 1
            """,
            (pid, user["id"]),
        ).fetchone()
        if not consent:
            log_audit(user["id"], "professional", "UNAUTHORIZED_PATIENT_ACCESS_BLOCKED", "patient", pid)
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Patient consent required. Submit an access request and wait for patient approval.",
            )
        if consent["expires_at"] and consent["expires_at"] < now:
            conn.execute("UPDATE consent_records SET status = 'expired' WHERE id = ?", (consent["id"],))
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Patient consent has expired.")

        scopes = set(json.loads(consent["scopes"]))
        patient_user = dict(
            conn.execute(
                "SELECT id, full_name, email, is_synthetic FROM user_profiles WHERE id = ?", (pid,)
            ).fetchone()
        )
        patient_meta = conn.execute("SELECT * FROM patient_profiles WHERE user_id = ?", (pid,)).fetchone()

        result: dict[str, Any] = {
            "medisync_id": ms["medisync_id"],
            "consent": {
                "id": consent["id"],
                "scopes": list(scopes),
                "granted_at": consent["granted_at"],
                "expires_at": consent["expires_at"],
            },
            "patient": {
                **patient_user,
                "profile": dict(patient_meta) if patient_meta else {},
            },
        }

        if "records" in scopes:
            result["documents"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT id, title, document_type, filename, document_date, extraction_status, is_synthetic FROM medical_documents WHERE patient_user_id = ? ORDER BY document_date DESC",
                    (pid,),
                ).fetchall()
            ]
            result["extracted"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM extracted_medical_info WHERE patient_user_id = ? ORDER BY observed_date DESC",
                    (pid,),
                ).fetchall()
            ]

        if "wearables" in scopes:
            result["wearables"] = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM wearable_observations WHERE patient_user_id = ? ORDER BY observed_at ASC",
                    (pid,),
                ).fetchall()
            ]

        if "baseline" in scopes:
            result["baselines"] = [
                dict(r) for r in conn.execute("SELECT * FROM personal_baselines WHERE patient_user_id = ?", (pid,)).fetchall()
            ]
            insights = [
                dict(r)
                for r in conn.execute(
                    "SELECT * FROM health_insights WHERE patient_user_id = ? ORDER BY created_at DESC", (pid,)
                ).fetchall()
            ]
            for ins in insights:
                ins["evidence"] = json.loads(ins.pop("evidence_json", "{}"))
            result["insights"] = insights

    if "timeline" in scopes:
        result["timeline"] = _build_patient_timeline(pid)

    if "ai_summary" in scopes:
        result["ai_contextual_summary"] = answer_health_question(
            pid,
            "Provide a structured longitudinal clinical prep summary connecting medical records, wearable trends, and personal baseline deviations.",
        )

    log_audit(user["id"], "professional", "VIEW_CONSENTED_PATIENT_RECORD", "patient", pid, {"scopes": list(scopes)})
    return result


# ---------------------------------------------------------------------------
# Admin Endpoints (Minimum Necessary Access - Zero Medical Record Exposure)
# ---------------------------------------------------------------------------
@app.get("/api/admin/overview")
def admin_overview(user: dict = Depends(require_role("admin"))) -> dict[str, Any]:
    with get_conn() as conn:
        total_patients = conn.execute("SELECT COUNT(*) AS c FROM user_profiles WHERE role = 'patient'").fetchone()["c"]
        total_pros = conn.execute("SELECT COUNT(*) AS c FROM user_profiles WHERE role = 'professional'").fetchone()["c"]
        pending_pros = conn.execute(
            "SELECT COUNT(*) AS c FROM professional_profiles WHERE verification_status = 'pending'"
        ).fetchone()["c"]
        verified_pros = conn.execute(
            "SELECT COUNT(*) AS c FROM professional_profiles WHERE verification_status = 'verified'"
        ).fetchone()["c"]
        active_consents = conn.execute(
            "SELECT COUNT(*) AS c FROM consent_records WHERE status = 'active'"
        ).fetchone()["c"]
        doc_count = conn.execute("SELECT COUNT(*) AS c FROM medical_documents").fetchone()["c"]
        wearable_count = conn.execute("SELECT COUNT(*) AS c FROM wearable_observations").fetchone()["c"]
        ai_count = conn.execute("SELECT COUNT(*) AS c FROM ai_conversations").fetchone()["c"]

        connector_stats = [
            dict(r)
            for r in conn.execute(
                """
                SELECT connector_key, display_name, integration_mode, status,
                       COUNT(*) AS configured_users,
                       SUM(records_imported) AS total_records_imported
                FROM device_connections
                GROUP BY connector_key, display_name, integration_mode, status
                """
            ).fetchall()
        ]

    return {
        "metrics": {
            "total_patients": total_patients,
            "total_professionals": total_pros,
            "pending_verifications": pending_pros,
            "verified_professionals": verified_pros,
            "active_consents": active_consents,
            "documents_stored_count": doc_count,
            "wearable_observations_count": wearable_count,
            "ai_queries_count": ai_count,
        },
        "device_monitoring": connector_stats,
        "system_health": {
            "api_status": "healthy",
            "database_engine": "Supabase PostgreSQL" if HAS_SUPABASE else "Local SQLite (Demo Mode)",
            "ai_provider": "Groq LLM + Grounded Context" if HAS_GROQ else "Deterministic Grounded Context Engine",
            "privacy_guard": "Active — Medical records & PHI are hidden from Admin endpoints",
        },
    }


@app.get("/api/admin/users")
def admin_list_users(user: dict = Depends(require_role("admin"))) -> dict[str, Any]:
    with get_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                """
                SELECT u.id, u.email, u.full_name, u.role, u.status, u.is_synthetic, u.created_at,
                       m.medisync_id,
                       pp.specialty, pp.registration_number, pp.facility_name, pp.verification_status
                FROM user_profiles u
                LEFT JOIN medisync_ids m ON m.patient_user_id = u.id
                LEFT JOIN professional_profiles pp ON pp.user_id = u.id
                ORDER BY u.created_at DESC
                """
            ).fetchall()
        ]
    return {"users": rows}


@app.post("/api/admin/professionals/{pro_user_id}/verify")
def admin_verify_professional(
    pro_user_id: str, payload: ProfessionalVerifyRequest, user: dict = Depends(require_role("admin"))
) -> dict[str, Any]:
    now = utcnow_iso()
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM professional_profiles WHERE user_id = ?", (pro_user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Healthcare professional not found.")
        conn.execute(
            "UPDATE professional_profiles SET verification_status = ?, verified_at = ?, verified_by = ? WHERE user_id = ?",
            (payload.decision, now, user["id"], pro_user_id),
        )
    log_audit(user["id"], "admin", f"PROFESSIONAL_{payload.decision.upper()}", "professional", pro_user_id)
    return {"user_id": pro_user_id, "verification_status": payload.decision}


@app.post("/api/admin/users/{target_user_id}/status")
def admin_set_user_status(
    target_user_id: str, payload: UserStatusRequest, user: dict = Depends(require_role("admin"))
) -> dict[str, Any]:
    if target_user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Administrators cannot suspend their own active session.")
    with get_conn() as conn:
        row = conn.execute("SELECT id, role FROM user_profiles WHERE id = ?", (target_user_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found.")
        conn.execute("UPDATE user_profiles SET status = ? WHERE id = ?", (payload.status, target_user_id))
    log_audit(user["id"], "admin", f"USER_STATUS_{payload.status.upper()}", "user", target_user_id)
    return {"user_id": target_user_id, "status": payload.status}


@app.get("/api/admin/audit-logs")
def admin_audit_logs(limit: int = Query(default=50, ge=1, le=200), user: dict = Depends(require_role("admin"))) -> dict[str, Any]:
    with get_conn() as conn:
        rows = [
            dict(r)
            for r in conn.execute(
                """
                SELECT al.*, u.full_name AS actor_name, u.email AS actor_email
                FROM audit_logs al
                LEFT JOIN user_profiles u ON u.id = al.actor_user_id
                ORDER BY al.created_at DESC LIMIT ?
                """,
                (limit,),
            ).fetchall()
        ]
    for r in rows:
        r["details"] = json.loads(r.pop("details_json", "{}"))
    return {"audit_logs": rows}


FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
