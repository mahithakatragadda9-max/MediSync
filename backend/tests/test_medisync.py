import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

TEST_DB = Path(__file__).resolve().parent / "test_medisync.db"
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

os.environ["MEDISYNC_DB_PATH"] = str(TEST_DB)
if TEST_DB.exists():
    TEST_DB.unlink()

from app import config as app_config  # noqa: E402
from app.main import app  # noqa: E402
from app.sample_data import build_simple_pdf  # noqa: E402
from app.services.ai_assistant import answer_health_question  # noqa: E402
from app.services.pdf_extractor import extract_medical_entities  # noqa: E402


def _fast_seed_noop() -> None:
    """No-op replacement for seed_demo_data during tests — we seed manually below."""
    pass


def _fast_ensure_noop() -> dict:
    """No-op replacement for ensure_sample_files during tests."""
    return {}


class MediSyncEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Patch the slow/network-dependent startup hooks so TestClient enters instantly.
        # We seed the minimum required demo data directly via init_db + a minimal insert.
        with patch("app.db.seed_demo_data", _fast_seed_noop), \
             patch("app.sample_data.ensure_sample_files", _fast_ensure_noop), \
             patch("app.main.seed_demo_data", _fast_seed_noop), \
             patch("app.main.ensure_sample_files", _fast_ensure_noop):
            cls._cm = TestClient(app)
            cls.client = cls._cm.__enter__()

        # Now seed the demo DB directly (outside ASGI thread — no deadlock risk).
        from app.db import init_db, seed_demo_data as real_seed
        try:
            real_seed()
        except Exception:
            pass  # Already seeded or partial seed is fine for tests

    @classmethod
    def tearDownClass(cls):
        cls._cm.__exit__(None, None, None)
        if TEST_DB.exists():
            TEST_DB.unlink()

    def _login(self, email: str, password: str) -> dict:
        resp = self.client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(resp.status_code, 200, resp.text)
        return resp.json()

    def test_01_health_and_frontend_served(self):
        h = self.client.get("/api/health")
        self.assertEqual(h.status_code, 200)
        self.assertEqual(h.json()["status"], "ok")

        landing = self.client.get("/")
        self.assertEqual(landing.status_code, 200)
        self.assertIn("Your Health Has a Story. MediSync Understands It.", landing.text)

    def test_02_patient_registration_qr_privacy_and_insufficient_baseline(self):
        reg = self.client.post(
            "/api/auth/register",
            json={
                "full_name": "Priya Test Patient",
                "email": "priya.test@medisync.local",
                "password": "StrongPassword123",
                "role": "patient",
                "age": 31,
                "sex": "Female",
                "blood_group": "O+",
            },
        )
        self.assertEqual(reg.status_code, 201, reg.text)
        data = reg.json()
        ms_id = data["user"]["medisync_id"]
        self.assertTrue(ms_id.startswith("MS-2026-"))
        headers = {"Authorization": f"Bearer {data['access_token']}"}

        ov = self.client.get("/api/patient/overview", headers=headers)
        self.assertEqual(ov.status_code, 200)
        qr_payload = ov.json()["patient"]["qr_payload"]
        self.assertEqual(qr_payload, f"medisync://lookup/{ms_id}")
        self.assertNotIn("Priya", qr_payload)
        self.assertNotIn("priya.test", qr_payload)

        # Role isolation check
        self.assertEqual(self.client.get("/api/admin/overview", headers=headers).status_code, 403)
        self.assertEqual(self.client.get("/api/professional/profile", headers=headers).status_code, 403)

        # Upload 3 days of wearable CSV -> baseline must report insufficient (< 7 days)
        csv_3d = (
            "observed_at,resting_hr,avg_hr,spo2,sleep_hours,steps,hrv_ms,activity_context\n"
            "2026-11-20T07:30:00Z,66,76,98.1,7.2,7500,52,moderate\n"
            "2026-11-21T07:30:00Z,65,74,98.3,7.4,8100,54,moderate\n"
            "2026-11-22T07:30:00Z,67,78,98.0,6.9,6900,50,moderate\n"
        ).encode("utf-8")
        imp = self.client.post(
            "/api/patient/wearables/import",
            headers=headers,
            files={"file": ("3d.csv", io.BytesIO(csv_3d), "text/csv")},
        )
        self.assertEqual(imp.status_code, 200, imp.text)
        base = self.client.get("/api/patient/baseline", headers=headers).json()
        self.assertTrue(all(b["confidence_level"] == "insufficient" for b in base["baselines"]))
        self.assertTrue(any(i["insight_type"] == "data_sufficiency" for i in base["insights"]))

    def test_03_demo_patient_pdf_extraction_baseline_and_ai(self):
        login = self._login("aarav.demo@medisync.local", "PatientDemo@2026")
        headers = {"Authorization": f"Bearer {login['access_token']}"}

        pdf_bytes = build_simple_pdf([
            "Follow-up Diagnostic Report",
            "Date: 2026-11-20",
            "Condition: Mild Dehydration Episode",
            "Allergy: Latex (mild sensitivity)",
            "Lab Result: Vitamin B12 = 410 pg/mL [Ref: 200 - 900 pg/mL] (Normal)",
        ])
        up = self.client.post(
            "/api/patient/records/upload",
            headers=headers,
            data={"title": "November Follow-up", "document_type": "lab_report", "document_date": "2026-11-20"},
            files={"file": ("followup.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        self.assertEqual(up.status_code, 201, up.text)
        up_json = up.json()
        self.assertGreaterEqual(up_json["extracted_count"], 3)
        first_id = up_json["extracted"][0]["id"]

        upd = self.client.put(
            f"/api/patient/extracted/{first_id}",
            headers=headers,
            json={"value": "Confirmed mild episode", "user_verified": True},
        )
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(upd.json()["item"]["user_verified"], 1)

        base = self.client.get("/api/patient/baseline", headers=headers).json()
        insight_types = {i["insight_type"] for i in base["insights"]}
        self.assertIn("persistent_deviation", insight_types)
        self.assertIn("activity_contextualized", insight_types)

        ai = self.client.post(
            "/api/patient/assistant/ask",
            headers=headers,
            json={"question": "Why have I been experiencing headaches recently?"},
        )
        self.assertEqual(ai.status_code, 200, ai.text)
        ans = ai.json()["answer"]
        self.assertGreater(len(ans["from_medical_records"]), 0)
        self.assertGreater(len(ans["wearable_observations"]), 0)
        self.assertGreater(len(ans["personal_baseline_comparison"]), 0)
        self.assertGreater(len(ans["possible_explanations"]), 0)
        self.assertGreater(len(ans["missing_information"]), 0)
        self.assertIn("does not diagnose", ans["disclaimer"].lower())

        guard = self.client.post(
            "/api/patient/assistant/ask",
            headers=headers,
            json={"question": "Should I stop taking my prescribed medication?"},
        )
        self.assertEqual(guard.status_code, 200)
        self.assertIn("cannot diagnose", guard.json()["answer"]["summary"].lower())

    def test_04_consent_gated_professional_and_admin_workflow(self):
        patient_login = self._login("aarav.demo@medisync.local", "PatientDemo@2026")
        p_headers = {"Authorization": f"Bearer {patient_login['access_token']}"}

        pro_login = self._login("dr.kavita@medisync.local", "DoctorDemo@2026")
        doc_headers = {"Authorization": f"Bearer {pro_login['access_token']}"}

        pending_pro = self._login("dr.rohan@medisync.local", "DoctorPending@2026")
        pend_headers = {"Authorization": f"Bearer {pending_pro['access_token']}"}

        admin_login = self._login("admin@medisync.local", "AdminDemo@2026")
        adm_headers = {"Authorization": f"Bearer {admin_login['access_token']}"}

        lk = self.client.get("/api/professional/lookup?query=medisync://lookup/MS-2026-482910", headers=doc_headers)
        self.assertEqual(lk.status_code, 200)
        self.assertFalse(lk.json()["consent_active"])
        self.assertNotIn("Aarav", lk.text)

        blocked = self.client.get("/api/professional/patients/MS-2026-482910", headers=doc_headers)
        self.assertEqual(blocked.status_code, 403)

        unverified_req = self.client.post(
            "/api/professional/access-requests",
            headers=pend_headers,
            json={"medisync_id": "MS-2026-482910", "purpose": "Cardiology review"},
        )
        self.assertEqual(unverified_req.status_code, 403)

        app_resp = self.client.post(
            "/api/patient/consent/respond",
            headers=p_headers,
            json={"request_id": "req-demo-001", "decision": "approve", "expires_days": 30},
        )
        self.assertEqual(app_resp.status_code, 200)
        consent_id = app_resp.json()["consent_id"]

        chart = self.client.get("/api/professional/patients/MS-2026-482910", headers=doc_headers)
        self.assertEqual(chart.status_code, 200)
        chart_json = chart.json()
        self.assertEqual(chart_json["medisync_id"], "MS-2026-482910")
        self.assertGreater(len(chart_json["extracted"]), 0)
        self.assertIn("ai_contextual_summary", chart_json)

        rev = self.client.post(f"/api/patient/consent/{consent_id}/revoke", headers=p_headers)
        self.assertEqual(rev.status_code, 200)
        self.assertEqual(self.client.get("/api/professional/patients/MS-2026-482910", headers=doc_headers).status_code, 403)

        adm_ov = self.client.get("/api/admin/overview", headers=adm_headers)
        self.assertEqual(adm_ov.status_code, 200)
        self.assertNotIn("documents", adm_ov.json())

        ver = self.client.post(
            "/api/admin/professionals/demo-pro-002/verify",
            headers=adm_headers,
            json={"decision": "verified"},
        )
        self.assertEqual(ver.status_code, 200)
        self.assertEqual(ver.json()["verification_status"], "verified")

        audits = self.client.get("/api/admin/audit-logs?limit=20", headers=adm_headers)
        self.assertEqual(audits.status_code, 200)
        actions = {a["action"] for a in audits.json()["audit_logs"]}
        self.assertIn("CONSENT_APPROVED", actions)
        self.assertIn("CONSENT_REVOKED", actions)
        self.assertIn("PROFESSIONAL_VERIFIED", actions)

    def test_05_groq_execution_and_dynamic_symptom_routing(self):
        # 1. Verify dynamic fallback differentiates stomach ache vs headache
        stomach_ans = answer_health_question("demo-patient-001", "I AM HAVING STOMACH ACHE")
        self.assertIn("stomach", stomach_ans["summary"].lower())
        self.assertNotIn("tension-type headaches", stomach_ans["summary"].lower())

        # 2. Verify Groq runs whenever HAS_GROQ=True regardless of DEMO_MODE=True and even when regex matches >= 2 lines
        mock_extraction_resp = MagicMock()
        mock_extraction_resp.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "document_date": "2026-11-24",
                        "conditions": [{"name": "Gastritis", "status": "Active", "confidence": 0.95}],
                        "medications": [{"name": "Pantoprazole", "dosage": "40 mg", "frequency": "Once daily before breakfast"}],
                        "allergies": [{"name": "Aspirin", "reaction": "GI irritation"}],
                        "lab_results": [{"name": "Hemoglobin", "value": "13.9", "unit": "g/dL", "reference_range": "13.5-17.5", "flag": "Normal"}],
                        "clinical_notes": [{"title": "Dietary Advice", "summary": "Avoid spicy food and NSAIDs for 2 weeks.", "category": "observation"}],
                    })
                )
            )
        ]

        mock_chat_resp = MagicMock()
        mock_chat_resp.choices = [
            MagicMock(
                message=MagicMock(
                    content=json.dumps({
                        "summary": "Your stomach ache may relate to GI irritation; your current Magnesium Glycinate and PRN Sumatriptan are noted alongside missing dietary/GI history.",
                        "from_medical_records": ["Magnesium Glycinate 200 mg (Source: synthetic_prescription.pdf)"],
                        "wearable_observations": ["Recent sleep averaged 5.0 hrs/night."],
                        "personal_baseline_comparison": ["No GI-specific baseline metric exists."],
                        "possible_explanations": ["Supplement timing or mild gastritis could contribute (non-diagnostic)."],
                        "missing_information": ["Pain location, nausea/fever status, and recent meals."],
                        "source_references": ["synthetic_prescription.pdf"],
                    })
                )
            )
        ]

        mock_client = MagicMock()
        mock_client.chat.completions.create.side_effect = [mock_extraction_resp, mock_chat_resp]

        with patch.object(app_config, "HAS_GROQ", True), \
             patch.object(app_config, "GROQ_API_KEY", "gsk_test_mock_key"), \
             patch.object(app_config, "DEMO_MODE", True), \
             patch("groq.Groq", return_value=mock_client):
            sample_text = (
                "Condition: Gastritis\n"
                "Medication: Pantoprazole 40 mg\n"
                "Observation: Avoid spicy food and NSAIDs for 2 weeks."
            )
            entities = extract_medical_entities(sample_text, "gi_note.pdf", "2026-11-24", use_llm=True)
            names = {e["name"] for e in entities}
            self.assertIn("Gastritis", names)
            self.assertIn("Pantoprazole", names)
            self.assertIn("Dietary Advice", names)
            # Ensure no duplicated raw line title == value
            for e in entities:
                self.assertNotEqual(e["name"], e.get("value"))

            ai_res = answer_health_question("demo-patient-001", "I AM HAVING STOMACH ACHE")
            self.assertTrue(ai_res["llm_provider"].startswith("groq:"))
            self.assertIn("stomach ache", ai_res["summary"].lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
