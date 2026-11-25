import csv
import io
import json
from datetime import datetime, timedelta
from pathlib import Path

from app.config import SAMPLE_DIR


def _escape_pdf_text(text: str) -> str:
    return text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def build_simple_pdf(lines: list[str]) -> bytes:
    """Create a valid single-page PDF containing clean, pypdf-extractable text lines."""
    stream_lines = ["BT", "/F1 11 Tf", "50 760 Td", "15 TL"]
    for idx, line in enumerate(lines):
        escaped = _escape_pdf_text(line)
        if idx == 0:
            stream_lines.append(f"({escaped}) Tj")
        else:
            stream_lines.append(f"T* ({escaped}) Tj")
    stream_lines.append("ET")
    stream_bytes = "\n".join(stream_lines).encode("latin-1", errors="replace")

    objects = [
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
        f"4 0 obj\n<< /Length {len(stream_bytes)} >>\nstream\n".encode("ascii")
        + stream_bytes
        + b"\nendstream\nendobj\n",
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
    ]

    output = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(len(output))
        output.extend(obj)

    xref_pos = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n".encode("ascii"))
    output.extend(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        output.extend(f"{off:010d} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode("ascii")
    )
    return bytes(output)


SYNTHETIC_LAB_PDF_LINES = [
    "SYNTHETIC DEMO MEDICAL REPORT - FOR HACKATHON DEMONSTRATION ONLY",
    "MediSync Partner Diagnostic Lab (Synthetic Sample)",
    "Report Date: 2026-10-18",
    "Patient Reference: Synthetic Demo Patient (Aarav Sharma)",
    "Ordering Clinician: Dr. Meenakshi Iyer (General Medicine)",
    "------------------------------------------------------------",
    "KNOWN CONDITIONS:",
    "Condition: Episodic Tension-Type Headaches",
    "Condition: Mild Vitamin D Deficiency",
    "Condition: Borderline Subclinical Hypothyroidism (Under Monitoring)",
    "ALLERGIES:",
    "Allergy: Penicillin (mild skin rash)",
    "Allergy: Sulfonamides (urticaria)",
    "LABORATORY TEST RESULTS:",
    "Lab Result: Vitamin D (25-OH) = 19.0 ng/mL [Ref: 30.0 - 100.0 ng/mL] (Low)",
    "Lab Result: TSH = 4.85 mIU/L [Ref: 0.40 - 4.20 mIU/L] (Borderline High)",
    "Lab Result: HbA1c = 5.6 % [Ref: 4.0 - 5.6 %] (Normal)",
    "Lab Result: Hemoglobin = 14.4 g/dL [Ref: 13.5 - 17.5 g/dL] (Normal)",
    "Lab Result: Fasting Glucose = 94 mg/dL [Ref: 70 - 99 mg/dL] (Normal)",
    "Lab Result: LDL Cholesterol = 118 mg/dL [Ref: < 100 mg/dL] (Borderline)",
    "Lab Result: Systolic/Diastolic BP = 126/82 mmHg (Normal-Elevated)",
    "CLINICAL OBSERVATIONS:",
    "Observation: Patient reports intermittent late-afternoon frontal headaches during periods of reduced sleep.",
    "Observation: Advised consistent sleep schedule, hydration, and Vitamin D repletion.",
]

SYNTHETIC_PRESCRIPTION_PDF_LINES = [
    "SYNTHETIC DEMO PRESCRIPTION - FOR HACKATHON DEMONSTRATION ONLY",
    "Outpatient Care Summary (Synthetic Sample)",
    "Prescription Date: 2026-11-02",
    "Prescriber: Dr. Kavita Rao (Internal Medicine)",
    "------------------------------------------------------------",
    "ACTIVE MEDICATIONS:",
    "Medication: Cholecalciferol (Vitamin D3) 60000 IU - Once weekly for 8 weeks",
    "Medication: Magnesium Glycinate 200 mg - Once nightly at bedtime",
    "Medication: Sumatriptan 50 mg - As needed for acute severe headache (max 2/week)",
    "DOCUMENTED ALLERGIES:",
    "Allergy: Penicillin (rash)",
    "CLINICAL EVENTS:",
    "Event: Follow-up scheduled in 6 weeks to repeat TSH and 25-OH Vitamin D.",
    "Observation: Track sleep duration and resting heart rate trends alongside headache frequency.",
]


def generate_synthetic_wearable_rows(days: int = 30) -> list[dict]:
    """Generate 30 days of synthetic wearable observations with an activity spike and a recent 4-day sleep+RHR shift."""
    base_day = datetime(2026, 11, 25, 7, 30, 0) - timedelta(days=days - 1)
    rows = []
    # Deterministic gentle variations
    rhr_offsets = [-1.2, 0.4, -0.5, 0.8, -0.3, 1.1, -0.8, 0.2, -1.0, 0.6,
                   -0.4, 0.5, 0.9, -0.7, 0.1, -0.6, 0.8, -0.2, 0.3, -0.9,
                   0.5, -0.3, 0.7, -0.4, 0.2, 1.4]
    sleep_offsets = [0.2, -0.1, 0.3, 0.0, -0.2, 0.4, 0.1, -0.3, 0.2, 0.0,
                     -0.1, 0.3, -0.2, 0.1, 0.2, -0.1, 0.0, 0.3, -0.2, 0.1,
                     0.2, -0.1, 0.0, 0.1, -0.2, -0.3]

    for i in range(days):
        dt = base_day + timedelta(days=i)
        if i == 11:
            # Intentional high-intensity exercise day: elevated avg_hr, normal resting_hr -> should NOT be flagged!
            rows.append({
                "observed_at": dt.strftime("%Y-%m-%dT07:30:00Z"),
                "resting_hr": 65.0,
                "avg_hr": 146.0,
                "spo2": 98.4,
                "sleep_hours": 7.6,
                "deep_sleep_hours": 1.8,
                "steps": 14200,
                "active_minutes": 72,
                "hrv_ms": 54.0,
                "activity_context": "vigorous_run",
                "quality_score": 0.96,
            })
        elif i >= days - 4:
            # Recent 4 days: persistent sleep deficit + elevated resting HR + lower HRV
            shift_idx = i - (days - 4)
            rows.append({
                "observed_at": dt.strftime("%Y-%m-%dT07:30:00Z"),
                "resting_hr": round(76.5 + shift_idx * 1.1, 1),
                "avg_hr": round(84.0 + shift_idx * 1.2, 1),
                "spo2": round(97.3 - shift_idx * 0.1, 1),
                "sleep_hours": round(5.2 - shift_idx * 0.15, 2),
                "deep_sleep_hours": round(0.85 - shift_idx * 0.05, 2),
                "steps": 4300 - shift_idx * 180,
                "active_minutes": 18 - shift_idx * 2,
                "hrv_ms": round(39.0 - shift_idx * 1.2, 1),
                "activity_context": "sedentary_desk",
                "quality_score": 0.93,
            })
        else:
            rhr = 64.5 + rhr_offsets[i % len(rhr_offsets)]
            slp = 7.4 + sleep_offsets[i % len(sleep_offsets)]
            rows.append({
                "observed_at": dt.strftime("%Y-%m-%dT07:30:00Z"),
                "resting_hr": round(rhr, 1),
                "avg_hr": round(rhr + 9.0 + (i % 4), 1),
                "spo2": round(98.2 + ((i % 3) - 1) * 0.2, 1),
                "sleep_hours": round(slp, 2),
                "deep_sleep_hours": round(slp * 0.23, 2),
                "steps": 7800 + ((i * 317) % 2100),
                "active_minutes": 38 + (i % 18),
                "hrv_ms": round(55.0 + ((i % 5) - 2) * 1.6, 1),
                "activity_context": "moderate_daily",
                "quality_score": 0.94,
            })
    return rows


def ensure_sample_files() -> dict[str, Path]:
    """Write downloadable synthetic sample PDF, CSV, and JSON files."""
    lab_pdf_path = SAMPLE_DIR / "synthetic_lab_report.pdf"
    rx_pdf_path = SAMPLE_DIR / "synthetic_prescription.pdf"
    wearable_csv_path = SAMPLE_DIR / "synthetic_wearable_30d.csv"
    wearable_json_path = SAMPLE_DIR / "synthetic_wearable_7d_update.json"

    lab_pdf_path.write_bytes(build_simple_pdf(SYNTHETIC_LAB_PDF_LINES))
    rx_pdf_path.write_bytes(build_simple_pdf(SYNTHETIC_PRESCRIPTION_PDF_LINES))

    rows = generate_synthetic_wearable_rows(30)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)
    wearable_csv_path.write_text(buf.getvalue(), encoding="utf-8")

    # 7-day sample JSON for quick CSV/JSON import demonstrations
    wearable_json_path.write_text(
        json.dumps(
            {
                "synthetic_notice": "Synthetic sample wearable export for MediSync demonstration",
                "source_device": "Synthetic Smartwatch JSON Export",
                "observations": rows[-7:],
            },
            indent=2,
        ),
        encoding="utf-8",
    )

    return {
        "lab_pdf": lab_pdf_path,
        "rx_pdf": rx_pdf_path,
        "wearable_csv": wearable_csv_path,
        "wearable_json": wearable_json_path,
    }
