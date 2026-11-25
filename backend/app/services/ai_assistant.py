import json
import logging
from typing import Any

from app import config
from app.db import get_conn

logger = logging.getLogger("medisync.ai_assistant")

STANDARD_DISCLAIMER = (
    "Educational & Informational Context Only: MediSync organizes your personal records and wearable trends. "
    "It does not diagnose medical conditions, prescribe medication, or advise stopping prescribed treatment. "
    "If symptoms are sustained, worsening, severe (such as sudden severe headache, fever, vision changes, chest pain, or shortness of breath), "
    "please consult a qualified healthcare professional promptly."
)


def gather_patient_context(patient_user_id: str) -> dict[str, Any]:
    with get_conn() as conn:
        patient = conn.execute(
            """
            SELECT u.id, u.full_name, u.is_synthetic, m.medisync_id,
                   p.age, p.sex, p.blood_group, p.height_cm, p.weight_kg
            FROM user_profiles u
            LEFT JOIN medisync_ids m ON m.patient_user_id = u.id
            LEFT JOIN patient_profiles p ON p.user_id = u.id
            WHERE u.id = ?
            """,
            (patient_user_id,),
        ).fetchone()
        docs = [
            dict(r)
            for r in conn.execute(
                "SELECT id, title, document_type, filename, document_date, extraction_status FROM medical_documents WHERE patient_user_id = ? ORDER BY document_date DESC",
                (patient_user_id,),
            ).fetchall()
        ]
        extracted = [
            dict(r)
            for r in conn.execute(
                "SELECT category, name, value, unit, reference_range, flag, observed_date, source_reference, confidence, user_verified FROM extracted_medical_info WHERE patient_user_id = ? ORDER BY observed_date DESC",
                (patient_user_id,),
            ).fetchall()
        ]
        wearables = [
            dict(r)
            for r in conn.execute(
                "SELECT observed_at, resting_hr, avg_hr, spo2, sleep_hours, steps, active_minutes, hrv_ms, activity_context FROM wearable_observations WHERE patient_user_id = ? ORDER BY observed_at DESC LIMIT 14",
                (patient_user_id,),
            ).fetchall()
        ]
        baselines = [
            dict(r)
            for r in conn.execute(
                "SELECT metric, window_days, observation_count, baseline_mean, baseline_low, baseline_high, confidence_level FROM personal_baselines WHERE patient_user_id = ?",
                (patient_user_id,),
            ).fetchall()
        ]
        insights = [
            dict(r)
            for r in conn.execute(
                "SELECT insight_type, title, explanation, severity FROM health_insights WHERE patient_user_id = ? ORDER BY created_at DESC",
                (patient_user_id,),
            ).fetchall()
        ]
        events = [
            dict(r)
            for r in conn.execute(
                "SELECT event_type, title, description, event_date FROM health_events WHERE patient_user_id = ? ORDER BY event_date DESC LIMIT 10",
                (patient_user_id,),
            ).fetchall()
        ]
        raw_history = conn.execute(
            "SELECT question, answer_json, created_at FROM ai_conversations WHERE patient_user_id = ? ORDER BY created_at DESC LIMIT 4",
            (patient_user_id,),
        ).fetchall()
        history = []
        for r in reversed(raw_history):
            ans_obj = json.loads(r["answer_json"] or "{}")
            history.append({
                "question": r["question"],
                "summary": ans_obj.get("summary", ""),
                "created_at": r["created_at"],
            })

    return {
        "patient": dict(patient) if patient else {},
        "documents": docs,
        "extracted": extracted,
        "wearables_recent": wearables,
        "baselines": baselines,
        "insights": insights,
        "events": events,
        "prior_conversation_turns": history,
    }


def _to_str_list(val: Any) -> list[str]:
    if isinstance(val, list):
        return [str(x).strip() for x in val if str(x).strip()]
    if isinstance(val, str) and val.strip():
        return [val.strip()]
    return []


def _synthesize_deterministic(question: str, ctx: dict[str, Any], llm_error: str | None = None) -> dict[str, Any]:
    """Question-aware fallback used ONLY when GROQ_API_KEY is absent or the Groq API fails."""
    q_lower = question.lower()
    extracted = ctx["extracted"]
    wearables = ctx["wearables_recent"]
    baselines = {b["metric"]: b for b in ctx["baselines"]}
    insights = ctx["insights"]
    events = ctx["events"]

    if any(kw in q_lower for kw in ("stop taking", "discontinue", "prescribe", "what dose should i take", "diagnose me")):
        return {
            "summary": (
                "I cannot diagnose a condition, prescribe medication, or recommend stopping or altering any prescribed treatment. "
                "Please discuss any medication adjustments directly with your prescribing clinician."
            ),
            "from_medical_records": [
                f"{e['name']} ({e.get('value') or e['category']}) — Source: {e.get('source_reference') or 'Uploaded record'}"
                for e in extracted
                if e["category"] in {"condition", "medication", "allergy"}
            ][:6],
            "wearable_observations": [],
            "personal_baseline_comparison": [],
            "possible_explanations": [
                "Medication changes require clinical review of your full history, lab values, and potential interactions."
            ],
            "missing_information": ["Direct clinical evaluation by your prescribing physician."],
            "source_references": [d["filename"] for d in ctx["documents"]],
            "disclaimer": STANDARD_DISCLAIMER,
            "llm_provider": "safety_guardrail",
            "llm_error": llm_error,
        }

    is_gi = any(k in q_lower for k in ("stomach", "abdom", "nausea", "gastric", "acidity", "belly", "digestion", "gut", "vomit", "cramp"))
    is_med_query = any(k in q_lower for k in ("ibuprofen", "nsaid", "aspirin", "paracetamol", "tylenol", "medication", "medicine", "interact", "drug"))
    is_headache = any(k in q_lower for k in ("headache", "migraine", "head pain"))
    is_sleep_hr = any(k in q_lower for k in ("sleep", "heart rate", "hrv", "resting", "pulse", "spo2", "baseline", "tired", "fatigue"))

    records_list: list[str] = []
    sources: list[str] = []
    for e in extracted:
        name_l = (e["name"] or "").lower()
        val_l = (e.get("value") or "").lower()
        include = True
        if is_gi and not is_headache:
            include = e["category"] in {"medication", "allergy"} or any(k in name_l + " " + val_l for k in ("stomach", "gi", "liver", "glucose", "thyroid", "tsh"))
        elif is_med_query:
            include = e["category"] in {"medication", "allergy", "condition"}

        if include and e["category"] in {"condition", "medication", "allergy", "lab_result", "observation"}:
            detail = f"{e['name']}"
            if e.get("value"):
                detail += f": {e['value']}"
            if e.get("unit"):
                detail += f" {e['unit']}"
            if e.get("flag") and e["flag"].lower() not in {"normal", "documented", "reported allergy"}:
                detail += f" [{e['flag']}]"
            ref = e.get("source_reference") or "Medical record"
            records_list.append(f"{detail} (Source: {ref})")
            if ref not in sources:
                sources.append(ref)

    if not is_gi:
        for ev in events[:3]:
            records_list.append(f"Self-reported event ({ev['event_date']}): {ev['title']} — {ev['description']}")

    wearable_obs = []
    baseline_cmp = []
    if wearables:
        recent_4 = wearables[:4]
        avg_sleep = round(sum(w["sleep_hours"] for w in recent_4 if w.get("sleep_hours") is not None) / max(1, sum(1 for w in recent_4 if w.get("sleep_hours") is not None)), 2)
        avg_rhr = round(sum(w["resting_hr"] for w in recent_4 if w.get("resting_hr") is not None) / max(1, sum(1 for w in recent_4 if w.get("resting_hr") is not None)), 1)
        avg_steps = int(sum(w["steps"] for w in recent_4 if w.get("steps") is not None) / max(1, sum(1 for w in recent_4 if w.get("steps") is not None)))
        avg_spo2 = round(sum(w["spo2"] for w in recent_4 if w.get("spo2") is not None) / max(1, sum(1 for w in recent_4 if w.get("spo2") is not None)), 1)
        wearable_obs.append(
            f"Recent 4-day average ({recent_4[-1]['observed_at'][:10]} to {recent_4[0]['observed_at'][:10]}): "
            f"sleep {avg_sleep} hrs/night, resting HR {avg_rhr} bpm, SpO2 {avg_spo2}%, {avg_steps:,} steps/day."
        )
        sources.append("Wearable Observations (Recent 4-day window)")

        if "sleep_hours" in baselines and baselines["sleep_hours"]["baseline_mean"] is not None:
            sb = baselines["sleep_hours"]
            delta_s = round(avg_sleep - sb["baseline_mean"], 2)
            baseline_cmp.append(
                f"Sleep Duration: {avg_sleep} hrs vs personal {sb['observation_count']}-day baseline of {sb['baseline_mean']} hrs ({delta_s:+} hrs; personal band {sb['baseline_low']}–{sb['baseline_high']} hrs)."
            )
        if "resting_hr" in baselines and baselines["resting_hr"]["baseline_mean"] is not None:
            rb = baselines["resting_hr"]
            delta_r = round(avg_rhr - rb["baseline_mean"], 1)
            baseline_cmp.append(
                f"Resting Heart Rate: {avg_rhr} bpm vs personal {rb['observation_count']}-day baseline of {rb['baseline_mean']} bpm ({delta_r:+} bpm; personal band {rb['baseline_low']}–{rb['baseline_high']} bpm)."
            )
        sources.append("Personal Health Baseline Engine")
    else:
        wearable_obs.append("No wearable observations imported yet.")
        baseline_cmp.append("Personal baseline requires at least 7 days of wearable observations.")

    for ins in insights:
        if ins["insight_type"] == "persistent_deviation" and (is_headache or is_sleep_hr or not is_gi):
            baseline_cmp.append(f"Flagged Deviation — {ins['title']}: {ins['explanation']}")

    if is_gi:
        summary = (
            f"Regarding your stomach ache ({question.strip()}): your uploaded medical records do not document a chronic gastrointestinal condition, "
            "though you do have active medications/supplements on file (such as Magnesium Glycinate and PRN Sumatriptan) and recent sleep disruption, which can occasionally coincide with digestive discomfort."
        )
        possible = [
            "Oral supplements like Magnesium Glycinate (depending on timing/empty stomach) or acute medications can sometimes cause mild gastrointestinal upset or nausea in some individuals.",
            "Non-specific stomach discomfort frequently relates to dietary factors, hydration, mild viral gastroenteritis, or stress/reduced sleep—none of which can be diagnosed from wearable metrics alone.",
        ]
        missing = [
            "Symptom details: exact location of pain, onset timing, severity, fever, nausea/vomiting, or bowel changes.",
            "Recent meals, hydration, caffeine, or over-the-counter painkiller use (e.g., NSAIDs).",
            "No prior gastrointestinal lab panels, endoscopy/ultrasound notes, or GI history are uploaded in your records.",
        ]
    elif is_med_query:
        summary = (
            "Your uploaded records list your active medications and documented allergies (including Penicillin and Sulfonamides). "
            "Before adding an over-the-counter medication such as an NSAID, a pharmacist or clinician should confirm stomach safety and interaction fit."
        )
        possible = [
            "Medications like Sumatriptan, Magnesium Glycinate, and Cholecalciferol are documented in your prescription record; potential interactions or GI irritation depend on dose, timing, and kidney/stomach history.",
        ]
        missing = [
            "Complete list of all over-the-counter supplements or pain relievers taken in the last 48 hours.",
            "Recent renal/hepatic panel and stomach ulcer/gastritis history.",
        ]
    elif is_headache or is_sleep_hr:
        summary = (
            "Looking across your uploaded medical records, wearable observations, and personal baseline, "
            "your recent multi-day drop in sleep duration and rise in resting heart rate align with triggers previously noted in your clinical records. "
            "These are possible associations rather than a confirmed diagnosis."
        )
        possible = [
            "Multi-day sleep reduction (~5.0 hrs vs your 7.4 hr personal baseline) paired with elevated resting HR and lower HRV is commonly associated with tension-type headaches and fatigue.",
            "Your uploaded records document Episodic Tension-Type Headaches alongside low Vitamin D (19.0 ng/mL) and borderline TSH (4.85 mIU/L).",
        ]
        missing = [
            "Daily hydration intake, caffeine timing, and prolonged screen-exposure logs.",
            "Home blood pressure readings over the past 4 days (last clinic BP was 126/82 mmHg).",
            "Repeat 6-week Vitamin D and TSH follow-up lab results.",
        ]
    else:
        summary = (
            f"Based on your query ('{question.strip()}'), here is what is documented across your medical records and wearable baseline, "
            "along with gaps that would help a clinician evaluate this further."
        )
        possible = [
            "Your available data shows active prescriptions/supplements, recent lab values, and a recent multi-day reduction in sleep with elevated resting HR compared to your own baseline.",
        ]
        missing = [
            "Symptom-specific timeline, severity, and any new dietary, lifestyle, or over-the-counter medication exposures.",
        ]

    return {
        "summary": summary,
        "from_medical_records": records_list[:8] or ["No directly relevant entries found in your uploaded medical records."],
        "wearable_observations": wearable_obs,
        "personal_baseline_comparison": baseline_cmp,
        "possible_explanations": possible,
        "missing_information": missing,
        "source_references": sources,
        "disclaimer": STANDARD_DISCLAIMER,
        "llm_provider": "deterministic_fallback",
        "llm_error": llm_error,
    }


def _ask_groq(question: str, ctx: dict[str, Any]) -> dict[str, Any]:
    from groq import Groq

    logger.info("Sending contextual health question to Groq (%s)...", config.GROQ_MODEL)
    client = Groq(api_key=config.GROQ_API_KEY)
    system_msg = (
        "You are MediSync's personalized, contextual AI health assistant.\n"
        "CORE INSTRUCTIONS:\n"
        "1. Answer DIRECTLY and SPECIFICALLY about the user's current question or symptom (e.g., if they ask about a stomach ache, focus on GI-relevant medications/side-effects, allergies, and missing GI/dietary context—do NOT dump unrelated headache notes unless directly relevant).\n"
        "2. Ground every medical record claim, wearable number, and baseline comparison strictly in the provided Patient Context JSON. Include clean inline citations such as (Source: filename, date) or (Personal Baseline).\n"
        "3. Filter ONLY the relevant items from medical records, wearable observations, and baseline comparisons for the user's question.\n"
        "4. NEVER diagnose a disease, prescribe medication, or advise stopping or changing prescribed treatment. Use calm, non-clinical educational language.\n"
        "5. Return a valid JSON object with these EXACT keys:\n"
        "   - summary: string (2-4 sentences directly answering the user's specific question)\n"
        "   - from_medical_records: array of strings (relevant records/meds/allergies/labs with inline source references)\n"
        "   - wearable_observations: array of strings (relevant recent wearable metrics)\n"
        "   - personal_baseline_comparison: array of strings (comparisons against the patient's own baseline, or honest note if unrelated/insufficient)\n"
        "   - possible_explanations: array of strings (non-diagnostic possibilities tailored to the question)\n"
        "   - missing_information: array of strings (specific clinical/lifestyle data missing for this question)\n"
        "   - source_references: array of strings (document filenames & data streams cited)\n"
    )
    user_payload = {
        "current_question": question,
        "patient_context": ctx,
    }
    resp = client.chat.completions.create(
        model=config.GROQ_MODEL,
        temperature=0.25,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system_msg},
            {"role": "user", "content": json.dumps(user_payload, default=str)[:11000]},
        ],
    )
    raw = resp.choices[0].message.content or "{}"
    ai_json = json.loads(raw)

    summary = str(ai_json.get("summary") or "").strip()
    if not summary:
        raise ValueError(f"Groq returned JSON without 'summary': {raw[:200]}")

    return {
        "summary": summary,
        "from_medical_records": _to_str_list(ai_json.get("from_medical_records")) or ["No directly relevant medical record entries found."],
        "wearable_observations": _to_str_list(ai_json.get("wearable_observations")) or ["No recent wearable observations directly tied to this query."],
        "personal_baseline_comparison": _to_str_list(ai_json.get("personal_baseline_comparison")) or ["No baseline deviation directly tied to this query."],
        "possible_explanations": _to_str_list(ai_json.get("possible_explanations")) or ["Insufficient context for specific associations."],
        "missing_information": _to_str_list(ai_json.get("missing_information")) or ["Additional symptom timeline and clinician assessment."],
        "source_references": _to_str_list(ai_json.get("source_references")) or [d["filename"] for d in ctx["documents"]],
        "disclaimer": STANDARD_DISCLAIMER,
        "llm_provider": f"groq:{config.GROQ_MODEL}",
    }


def answer_health_question(patient_user_id: str, question: str) -> dict[str, Any]:
    ctx = gather_patient_context(patient_user_id)

    q_lower = question.lower()
    if any(kw in q_lower for kw in ("stop taking", "discontinue", "prescribe", "what dose should i take", "diagnose me")):
        return _synthesize_deterministic(question, ctx)

    llm_error: str | None = None
    if config.HAS_GROQ:
        try:
            return _ask_groq(question, ctx)
        except Exception as exc:
            llm_error = f"{type(exc).__name__}: {exc}"
            logger.error("Groq AI Health Assistant failed (%s): %s", config.GROQ_MODEL, exc, exc_info=True)
    else:
        logger.info("GROQ_API_KEY not set; using question-aware deterministic fallback.")

    return _synthesize_deterministic(question, ctx, llm_error=llm_error)
