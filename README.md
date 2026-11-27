# MediSync — AI-Powered Personal Health Intelligence Platform

**Your Health. Your History. Your Intelligence.**

## Live Links

- **Live Deployed App:** [https://vercel.app](https://medi-sync-ashen.vercel.app?_vercel_share=oGCj4emgNXTVSa6u2wktivDAGYb8HDzP)
- **Demo Video Walkthrough:** [Watch Demo Video](https://drive.google.com/file/d/18WGkSJbfaZJPFPEo3g7xwnkCXeQzUmqx/view?usp=drivesdk)

MediSync unifies fragmented wearable telemetry, diagnostic laboratory reports, and clinical prescriptions into a longitudinal personal health context. Instead of relying on static population averages, MediSync establishes an individualized **Personal Health Baseline**, detects meaningful multi-metric deviations, and provides context-grounded, non-diagnostic insights through a personalized **AI Health Assistant**.

---

## Core Features

- **Clinical Document Extraction:** Upload PDF lab reports and prescriptions to extract conditions, medications (with dosage & frequency), allergies, and lab values with page-and-line source attribution.
- **Wearable Sensor Intelligence:** Ingest multi-day physiological telemetry (Resting Heart Rate, HRV, SpO₂, Sleep Duration, and Daily Steps) via standardized CSV/JSON schemas with interactive trend visualizations.
- **Personal Health Baseline Engine:** Calculates rolling individualized physiological ranges and flags multi-day anomalies (e.g., sleep debt paired with resting heart rate elevation and HRV dips) with confidence indicators.
- **Context-Grounded AI Health Assistant:** Powered by Groq LLM (`openai/gpt-oss-120b`), synthesizing permitted medical records, wearable observations, and baseline comparisons into structured, non-diagnostic insights with strict medical safety guardrails.
- **Longitudinal Health Timeline:** Chronological view uniting clinical records, prescriptions, wearable alerts, and user-logged health events.
- **Privacy-First QR Sharing & Consent Control:** Unique MediSync ID, privacy-safe QR code, and granular, revocable clinician access permissions with an audit trail.

---

## Tech Stack & Dependencies

- **Frontend:** HTML5, CSS3, Vanilla JavaScript, Interactive Time-Series Charts, QRCode.js
- **Backend:** Python 3, FastAPI, Uvicorn, PyJWT, python-dotenv
- **AI & Document Processing:** Groq Cloud API (`openai/gpt-oss-120b`), `pypdf`
- **Database & Storage:** SQLite (Local Demo Mode) with optional Supabase (PostgreSQL & Auth) support

---

## Project Structure

```text
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI routes & static serving
│   │   ├── config.py            # Environment & model configuration
│   │   ├── auth.py              # JWT session & role authentication
│   │   ├── db.py                # SQLite / Supabase data layer
│   │   └── services/
│   │       ├── ai_assistant.py  # Context-grounded Groq AI assistant
│   │       ├── pdf_extractor.py # Clinical PDF parser & structurer
│   │       ├── wearable_engine.py # Baseline & anomaly detection engine
│   │       └── qr_service.py    # Privacy-safe MediSync QR generator
│   ├── data/samples/            # Synthetic lab reports, prescriptions & wearable CSV/JSON
│   ├── .env.example             # Environment variable template
│   └── requirements.txt         # Python dependencies
├── frontend/                    # MediSync SaaS UI (Landing, Patient, Clinician & Admin views)
└── html/                        # Base template reference
```

---

## Quick Start (Local Demo Mode)

1. **Clone the repository:**
   ```bash
   git clone https://github.com
   cd MediSync/backend
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```
   Open `.env` and add your `GROQ_API_KEY` (with `GROQ_MODEL=openai/gpt-oss-120b`). Leave `MEDISYNC_DEMO_MODE=true` to run immediately without external database setup.

4. **Start the server:**
   ```bash
   uvicorn app.main:app --reload --port 8000
   ```
   Open `http://127.0.0.1:8000` in your browser and sign in with the one-click demo patient account.

---

## Disclaimer

*MediSync is an informational health intelligence prototype built for educational and hackathon demonstration purposes. It does not diagnose medical conditions, prescribe medication, or replace professional clinical judgment.*
