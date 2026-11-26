import json
import os
import secrets
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

import psycopg2
from psycopg2.extras import RealDictCursor

from app.config import DB_PATH, UPLOAD_DIR
from app.sample_data import (
    SYNTHETIC_LAB_PDF_LINES,
    SYNTHETIC_PRESCRIPTION_PDF_LINES,
    ensure_sample_files,
    generate_synthetic_wearable_rows,
)


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _translate_sql(sql: str) -> str:
    # Convert SQLite '?' placeholders and 'INSERT OR IGNORE' to PostgreSQL syntax
    translated = sql.replace("?", "%s")
    if "INSERT OR IGNORE" in translated:
        translated = translated.replace("INSERT OR IGNORE", "INSERT") + " ON CONFLICT DO NOTHING"
    return translated


class _PgCursorWrapper:
    def __init__(self, cur):
        self._cur = cur

    def execute(self, sql: str, params=None):
        pg_sql = _translate_sql(sql)
        if params is not None:
            self._cur.execute(pg_sql, params)
        else:
            self._cur.execute(pg_sql)
        return self

    def executemany(self, sql: str, seq_of_params):
        self._cur.executemany(_translate_sql(sql), seq_of_params)
        return self

    def fetchone(self):
        return self._cur.fetchone()

    def fetchall(self):
        return self._cur.fetchall()

    @property
    def rowcount(self):
        return self._cur.rowcount


class _PgConnWrapper:
    def __init__(self, raw_conn):
        self._conn = raw_conn

    def execute(self, sql: str, params=None):
        cur = _PgCursorWrapper(self._conn.cursor(cursor_factory=RealDictCursor))
        return cur.execute(sql, params)

    def executemany(self, sql: str, seq_of_params):
        cur = _PgCursorWrapper(self._conn.cursor(cursor_factory=RealDictCursor))
        return cur.executemany(sql, seq_of_params)

    def executescript(self, script: str):
        with self._conn.cursor() as cur:
            cur.execute(script)

    def cursor(self):
        return _PgCursorWrapper(self._conn.cursor(cursor_factory=RealDictCursor))

    def commit(self):
        self._conn.commit()

    def close(self):
        self._conn.close()


@contextmanager
def get_conn():
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        conn = _PgConnWrapper(psycopg2.connect(db_url))
    else:
        conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS user_profiles (
                id TEXT PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK (role IN ('patient', 'professional', 'admin')),
                status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
                is_synthetic INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS patient_profiles (
                user_id TEXT PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
                age INTEGER,
                sex TEXT,
                blood_group TEXT,
                height_cm REAL,
                weight_kg REAL,
                emergency_note TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS medisync_ids (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT UNIQUE NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                medisync_id TEXT UNIQUE NOT NULL,
                qr_token TEXT UNIQUE NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS professional_profiles (
                user_id TEXT PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
                specialty TEXT NOT NULL,
                registration_number TEXT NOT NULL,
                facility_name TEXT,
                verification_status TEXT NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('pending', 'verified', 'rejected')),
                verified_at TEXT,
                verified_by TEXT
            );

            CREATE TABLE IF NOT EXISTS medical_documents (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                title TEXT NOT NULL,
                document_type TEXT NOT NULL,
                filename TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                document_date TEXT,
                extraction_status TEXT NOT NULL DEFAULT 'extracted',
                raw_text TEXT,
                is_synthetic INTEGER NOT NULL DEFAULT 0,
                uploaded_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS extracted_medical_info (
                id TEXT PRIMARY KEY,
                document_id TEXT NOT NULL REFERENCES medical_documents(id) ON DELETE CASCADE,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                category TEXT NOT NULL CHECK (category IN ('condition', 'medication', 'allergy', 'lab_result', 'observation', 'event')),
                name TEXT NOT NULL,
                value TEXT,
                unit TEXT,
                reference_range TEXT,
                flag TEXT,
                observed_date TEXT,
                source_reference TEXT,
                confidence REAL NOT NULL DEFAULT 0.85,
                user_verified INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS device_connections (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                connector_key TEXT NOT NULL,
                display_name TEXT NOT NULL,
                integration_mode TEXT NOT NULL,
                status TEXT NOT NULL,
                honest_note TEXT NOT NULL,
                last_sync_at TEXT,
                records_imported INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS wearable_observations (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                source_connector TEXT NOT NULL,
                observed_at TEXT NOT NULL,
                resting_hr REAL,
                avg_hr REAL,
                spo2 REAL,
                sleep_hours REAL,
                deep_sleep_hours REAL,
                steps INTEGER,
                active_minutes INTEGER,
                hrv_ms REAL,
                activity_context TEXT,
                quality_score REAL DEFAULT 0.9,
                is_synthetic INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS personal_baselines (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                metric TEXT NOT NULL,
                window_days INTEGER NOT NULL,
                observation_count INTEGER NOT NULL,
                baseline_mean REAL,
                baseline_std REAL,
                baseline_low REAL,
                baseline_high REAL,
                confidence_level TEXT NOT NULL,
                computed_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS health_insights (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                insight_type TEXT NOT NULL,
                title TEXT NOT NULL,
                explanation TEXT NOT NULL,
                severity TEXT NOT NULL,
                evidence_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                actor_user_id TEXT NOT NULL,
                question TEXT NOT NULL,
                answer_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS health_events (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                event_type TEXT NOT NULL,
                title TEXT NOT NULL,
                description TEXT NOT NULL,
                event_date TEXT NOT NULL,
                severity TEXT DEFAULT 'info',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS access_requests (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                professional_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL,
                requested_scopes TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TEXT NOT NULL,
                decided_at TEXT
            );

            CREATE TABLE IF NOT EXISTS consent_records (
                id TEXT PRIMARY KEY,
                patient_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                professional_user_id TEXT NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
                scopes TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                granted_at TEXT NOT NULL,
                expires_at TEXT,
                revoked_at TEXT
            );

            CREATE TABLE IF NOT EXISTS audit_logs (
                id TEXT PRIMARY KEY,
                actor_user_id TEXT,
                actor_role TEXT,
                action TEXT NOT NULL,
                target_type TEXT,
                target_id TEXT,
                details_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            """
        )


def log_audit(
    actor_user_id: str | None,
    actor_role: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    details: dict[str, Any] | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO audit_logs (id, actor_user_id, actor_role, action, target_type, target_id, details_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                actor_user_id,
                actor_role,
                action,
                target_type,
                target_id,
                json.dumps(details or {}),
                utcnow_iso(),
            ),
        )


def generate_medisync_id(conn: sqlite3.Connection) -> tuple[str, str]:
    for _ in range(25):
        digits = "".join(str(secrets.randbelow(10)) for _ in range(6))
        ms_id = f"MS-2026-{digits}"
        exists = conn.execute("SELECT 1 FROM medisync_ids WHERE medisync_id = ?", (ms_id,)).fetchone()
        if not exists:
            return ms_id, f"mstok_{secrets.token_urlsafe(18)}"
    raise RuntimeError("Unable to allocate unique MediSync ID")


def default_device_connectors(patient_user_id: str, conn: sqlite3.Connection, imported_count: int = 0) -> None:
    now = utcnow_iso()
    connectors = [
        (
            "csv_import",
            "Wearable CSV Importer",
            "csv_import",
            "active_import" if imported_count > 0 else "ready",
            "Active local/backend CSV ingestion pipeline.",
            now if imported_count > 0 else None,
            imported_count,
        ),
        (
            "json_import",
            "Wearable JSON Importer",
            "json_import",
            "ready",
            "Active structured JSON health export importer.",
            None,
            0,
        ),
        (
            "apple_health",
            "Apple HealthKit Bridge",
            "api_unavailable",
            "unavailable",
            "Requires native iOS HealthKit entitlement & companion app (not live-connected in web MVP).",
            None,
            0,
        ),
        (
            "google_health_connect",
            "Google Health Connect",
            "api_unavailable",
            "unavailable",
            "Requires Android Health Connect SDK permissions (not live-connected in web MVP).",
            None,
            0,
        ),
        (
            "garmin_oura_fitbit",
            "Smartwatch / Ring OAuth Connectors",
            "api_unavailable",
            "unavailable",
            "Vendor OAuth developer credentials not configured; use CSV/JSON export import.",
            None,
            0,
        ),
    ]
    for key, name, mode, status, note, sync_at, count in connectors:
        conn.execute(
            """
            INSERT INTO device_connections
            (id, patient_user_id, connector_key, display_name, integration_mode, status, honest_note, last_sync_at, records_imported)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), patient_user_id, key, name, mode, status, note, sync_at, count),
        )


def get_user_by_id(user_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_profiles WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None


def get_user_by_email(email: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM user_profiles WHERE lower(email) = lower(?)", (email.strip(),)).fetchone()
        return dict(row) if row else None


def seed_demo_data() -> None:
    """Seed clearly labelled synthetic demo users, documents, wearable history, baselines, deviations & audit logs."""
    from app.auth import hash_password
    from app.services.pdf_extractor import extract_medical_entities
    from app.services.wearable_engine import recompute_patient_intelligence

    sample_paths = ensure_sample_files()

    with get_conn() as conn:
        existing = conn.execute("SELECT COUNT(*) AS c FROM user_profiles").fetchone()["c"]
        if existing > 0:
            return

        now = utcnow_iso()
        patient_id = "demo-patient-001"
        pro_verified_id = "demo-pro-001"
        pro_pending_id = "demo-pro-002"
        admin_id = "demo-admin-001"

        users = [
            (patient_id, "aarav.demo@medisync.local", hash_password("PatientDemo@2026"), "Aarav Sharma (Synthetic Demo)", "patient", "active", 1, now),
            (pro_verified_id, "dr.kavita@medisync.local", hash_password("DoctorDemo@2026"), "Dr. Kavita Rao (Demo Clinician)", "professional", "active", 1, now),
            (pro_pending_id, "dr.rohan@medisync.local", hash_password("DoctorPending@2026"), "Dr. Rohan Mehta (Pending Verification)", "professional", "active", 1, now),
            (admin_id, "admin@medisync.local", hash_password("AdminDemo@2026"), "Meera Nair (Platform Admin)", "admin", "active", 1, now),
        ]
        conn.executemany(
            """
            INSERT INTO user_profiles (id, email, password_hash, full_name, role, status, is_synthetic, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            users,
        )

        conn.execute(
            """
            INSERT INTO patient_profiles (user_id, age, sex, blood_group, height_cm, weight_kg, emergency_note, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (patient_id, 29, "Male", "B+", 175.0, 71.5, "Synthetic Demo Profile: Penicillin & Sulfa allergy", now),
        )

        conn.execute(
            """
            INSERT INTO medisync_ids (id, patient_user_id, medisync_id, qr_token, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), patient_id, "MS-2026-482910", "mstok_demo_482910_opaque", now),
        )

        conn.execute(
            """
            INSERT INTO professional_profiles (user_id, specialty, registration_number, facility_name, verification_status, verified_at, verified_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pro_verified_id, "Internal Medicine", "NMC-KA-44821 (Demo)", "MediSync Clinical Collaboration Sandbox", "verified", now, admin_id),
        )
        conn.execute(
            """
            INSERT INTO professional_profiles (user_id, specialty, registration_number, facility_name, verification_status, verified_at, verified_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (pro_pending_id, "Cardiology", "NMC-MH-79104 (Demo)", "Metro Care Clinic (Synthetic)", "pending", None, None),
        )

        # Copy sample PDFs into patient upload directory
        patient_upload_dir = UPLOAD_DIR / patient_id
        patient_upload_dir.mkdir(parents=True, exist_ok=True)
        lab_dest = patient_upload_dir / "synthetic_lab_report.pdf"
        rx_dest = patient_upload_dir / "synthetic_prescription.pdf"
        lab_dest.write_bytes(sample_paths["lab_pdf"].read_bytes())
        rx_dest.write_bytes(sample_paths["rx_pdf"].read_bytes())

        lab_text = "\n".join(SYNTHETIC_LAB_PDF_LINES)
        rx_text = "\n".join(SYNTHETIC_PRESCRIPTION_PDF_LINES)

        doc1_id = "doc-demo-lab-001"
        doc2_id = "doc-demo-rx-002"
        conn.execute(
            """
            INSERT INTO medical_documents
            (id, patient_user_id, title, document_type, filename, storage_path, document_date, extraction_status, raw_text, is_synthetic, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (doc1_id, patient_id, "Comprehensive Thyroid, Lipid & Vitamin Panel (Synthetic)", "lab_report", "synthetic_lab_report.pdf", str(lab_dest), "2026-10-18", "reviewed", lab_text, 1, "2026-10-19T09:00:00Z"),
        )
        conn.execute(
            """
            INSERT INTO medical_documents
            (id, patient_user_id, title, document_type, filename, storage_path, document_date, extraction_status, raw_text, is_synthetic, uploaded_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (doc2_id, patient_id, "Outpatient Headache & Supplement Prescription (Synthetic)", "prescription", "synthetic_prescription.pdf", str(rx_dest), "2026-11-02", "extracted", rx_text, 1, "2026-11-02T14:20:00Z"),
        )

        # Extract entities from both documents
        for doc_id, doc_title, doc_date, text, verified in [
            (doc1_id, "synthetic_lab_report.pdf", "2026-10-18", lab_text, 1),
            (doc2_id, "synthetic_prescription.pdf", "2026-11-02", rx_text, 0),
        ]:
            entities = extract_medical_entities(text, doc_title, doc_date, use_llm=False)
            for ent in entities:
                conn.execute(
                    """
                    INSERT INTO extracted_medical_info
                    (id, document_id, patient_user_id, category, name, value, unit, reference_range, flag, observed_date, source_reference, confidence, user_verified, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        doc_id,
                        patient_id,
                        ent["category"],
                        ent["name"],
                        ent.get("value"),
                        ent.get("unit"),
                        ent.get("reference_range"),
                        ent.get("flag"),
                        ent.get("observed_date") or doc_date,
                        ent.get("source_reference"),
                        ent.get("confidence", 0.90),
                        verified,
                        now,
                    ),
                )

        # Seed 30 days of synthetic wearable observations
        rows = generate_synthetic_wearable_rows(30)
        for row in rows:
            conn.execute(
                """
                INSERT INTO wearable_observations
                (id, patient_user_id, source_connector, observed_at, resting_hr, avg_hr, spo2, sleep_hours, deep_sleep_hours, steps, active_minutes, hrv_ms, activity_context, quality_score, is_synthetic)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    patient_id,
                    "csv_import",
                    row["observed_at"],
                    row["resting_hr"],
                    row["avg_hr"],
                    row["spo2"],
                    row["sleep_hours"],
                    row["deep_sleep_hours"],
                    row["steps"],
                    row["active_minutes"],
                    row["hrv_ms"],
                    row["activity_context"],
                    row["quality_score"],
                    1,
                ),
            )

        default_device_connectors(patient_id, conn, imported_count=len(rows))

        # Seed user-entered health events
        events = [
            ("symptom", "Recurrent afternoon frontal headaches", "Mild-to-moderate dull headache around 4 PM on 3 of the last 4 workdays.", "2026-11-23", "attention"),
            ("checkup", "Annual Preventive Checkup (Synthetic)", "Reviewed Vitamin D and TSH with primary care physician; advised sleep consistency.", "2026-10-20", "info"),
        ]
        for etype, title, desc, edate, sev in events:
            conn.execute(
                """
                INSERT INTO health_events (id, patient_user_id, event_type, title, description, event_date, severity, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (str(uuid.uuid4()), patient_id, etype, title, desc, edate, sev, now),
            )

        # Seed a pending access request from Dr. Kavita Rao so consent workflow is immediately demonstrable
        conn.execute(
            """
            INSERT INTO access_requests (id, patient_user_id, professional_user_id, purpose, requested_scopes, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "req-demo-001",
                patient_id,
                pro_verified_id,
                "Follow-up review of recurring headaches, Vitamin D repletion, and recent sleep/resting HR trends.",
                json.dumps(["records", "wearables", "baseline", "timeline", "ai_summary"]),
                "pending",
                now,
            ),
        )

    # Recompute personal baseline & contextual deviation insights outside transaction lock
    recompute_patient_intelligence(patient_id)
    log_audit(admin_id, "admin", "SEED_SYNTHETIC_DEMO", "system", patient_id, {"note": "Initialized clearly labelled synthetic demo environment"})
