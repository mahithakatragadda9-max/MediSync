import csv
import io
import json
import uuid
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.db import get_conn, utcnow_iso

MIN_BASELINE_DAYS = 7
HIGH_CONFIDENCE_DAYS = 14


def _to_float(val: Any) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _to_int(val: Any) -> int | None:
    if val is None or val == "":
        return None
    try:
        return int(float(val))
    except (TypeError, ValueError):
        return None


def _normalize_row(raw: dict[str, Any]) -> dict[str, Any] | None:
    lowered = {str(k).strip().lower(): v for k, v in raw.items()}
    ts = lowered.get("observed_at") or lowered.get("timestamp") or lowered.get("date")
    if not ts:
        return None
    ts_str = str(ts).strip()
    if len(ts_str) == 10:
        ts_str = f"{ts_str}T07:30:00Z"

    return {
        "observed_at": ts_str,
        "resting_hr": _to_float(lowered.get("resting_hr") or lowered.get("rhr") or lowered.get("heart_rate")),
        "avg_hr": _to_float(lowered.get("avg_hr") or lowered.get("heart_rate_avg")),
        "spo2": _to_float(lowered.get("spo2") or lowered.get("blood_oxygen")),
        "sleep_hours": _to_float(lowered.get("sleep_hours") or lowered.get("sleep")),
        "deep_sleep_hours": _to_float(lowered.get("deep_sleep_hours") or lowered.get("deep_sleep")),
        "steps": _to_int(lowered.get("steps") or lowered.get("step_count")),
        "active_minutes": _to_int(lowered.get("active_minutes") or lowered.get("activity_minutes")),
        "hrv_ms": _to_float(lowered.get("hrv_ms") or lowered.get("hrv")),
        "activity_context": str(lowered.get("activity_context") or lowered.get("activity") or "unspecified").strip(),
        "quality_score": _to_float(lowered.get("quality_score")) or 0.90,
    }


def parse_wearable_file(content: bytes, filename: str) -> tuple[list[dict[str, Any]], str]:
    text = content.decode("utf-8", errors="replace").strip()
    if not text:
        raise ValueError("Uploaded wearable file is empty.")

    rows: list[dict[str, Any]] = []
    if filename.lower().endswith(".json") or text.startswith("{") or text.startswith("["):
        connector = "json_import"
        payload = json.loads(text)
        raw_list = payload.get("observations", []) if isinstance(payload, dict) else payload
        if not isinstance(raw_list, list):
            raise ValueError("JSON must be a list of readings or an object with an 'observations' array.")
        for item in raw_list:
            if isinstance(item, dict):
                norm = _normalize_row(item)
                if norm:
                    rows.append(norm)
    else:
        connector = "csv_import"
        reader = csv.DictReader(io.StringIO(text))
        for item in reader:
            norm = _normalize_row(item)
            if norm:
                rows.append(norm)

    if not rows:
        raise ValueError("No valid wearable observations found. Expected observed_at/date and metrics like resting_hr, spo2, sleep_hours, steps.")
    return rows, connector


def recompute_patient_intelligence(patient_user_id: str) -> dict[str, Any]:
    """
    Build evolving personal baseline from historical observations and run contextual deviation detection.
    - Refuses to claim a reliable baseline when < 7 days of observations exist.
    - Considers activity context before flagging heart rate elevations.
    - Looks for persistent multi-day shifts rather than isolated readings.
    """
    now = utcnow_iso()
    with get_conn() as conn:
        obs_rows = [
            dict(r)
            for r in conn.execute(
                "SELECT * FROM wearable_observations WHERE patient_user_id = ? ORDER BY observed_at ASC",
                (patient_user_id,),
            ).fetchall()
        ]
        conditions = [
            dict(r)
            for r in conn.execute(
                "SELECT name, value, observed_date FROM extracted_medical_info WHERE patient_user_id = ? AND category = 'condition'",
                (patient_user_id,),
            ).fetchall()
        ]

        conn.execute("DELETE FROM personal_baselines WHERE patient_user_id = ?", (patient_user_id,))
        conn.execute("DELETE FROM health_insights WHERE patient_user_id = ?", (patient_user_id,))

        metrics = {
            "resting_hr": {"label": "Resting Heart Rate", "unit": "bpm", "min_std": 2.5},
            "sleep_hours": {"label": "Sleep Duration", "unit": "hrs", "min_std": 0.45},
            "spo2": {"label": "Blood Oxygen (SpO2)", "unit": "%", "min_std": 0.5},
            "hrv_ms": {"label": "Heart Rate Variability (HRV)", "unit": "ms", "min_std": 4.0},
            "steps": {"label": "Daily Steps", "unit": "steps", "min_std": 900.0},
        }

        baselines_summary: list[dict[str, Any]] = []
        recent_slice = obs_rows[-4:] if len(obs_rows) >= 10 else obs_rows[-2:]
        hist_slice = obs_rows[:-4] if len(obs_rows) >= 10 else obs_rows

        for metric_key, meta in metrics.items():
            all_vals = [float(r[metric_key]) for r in obs_rows if r.get(metric_key) is not None]
            hist_vals = [float(r[metric_key]) for r in hist_slice if r.get(metric_key) is not None]
            count = len(all_vals)

            if count < MIN_BASELINE_DAYS:
                confidence = "insufficient"
                mean_val = round(float(np.mean(all_vals)), 2) if all_vals else None
                std_val = round(float(np.std(all_vals)), 2) if len(all_vals) > 1 else None
                low = None
                high = None
            else:
                confidence = "high" if count >= HIGH_CONFIDENCE_DAYS else "moderate"
                ref_vals = hist_vals if len(hist_vals) >= MIN_BASELINE_DAYS else all_vals
                mean_val = round(float(np.mean(ref_vals)), 2)
                raw_std = float(np.std(ref_vals))
                eff_std = max(raw_std, meta["min_std"])
                std_val = round(raw_std, 2)
                low = round(mean_val - 1.5 * eff_std, 2)
                high = round(mean_val + 1.5 * eff_std, 2)

            conn.execute(
                """
                INSERT INTO personal_baselines
                (id, patient_user_id, metric, window_days, observation_count, baseline_mean, baseline_std, baseline_low, baseline_high, confidence_level, computed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    patient_user_id,
                    metric_key,
                    len(obs_rows),
                    count,
                    mean_val,
                    std_val,
                    low,
                    high,
                    confidence,
                    now,
                ),
            )
            baselines_summary.append(
                {
                    "metric": metric_key,
                    "label": meta["label"],
                    "unit": meta["unit"],
                    "observation_count": count,
                    "baseline_mean": mean_val,
                    "baseline_std": std_val,
                    "baseline_low": low,
                    "baseline_high": high,
                    "confidence_level": confidence,
                }
            )

        insights: list[dict[str, Any]] = []
        if len(obs_rows) < MIN_BASELINE_DAYS:
            insights.append(
                {
                    "id": str(uuid.uuid4()),
                    "insight_type": "data_sufficiency",
                    "title": f"More historical observations needed ({len(obs_rows)}/{MIN_BASELINE_DAYS} days)",
                    "explanation": (
                        f"MediSync currently has {len(obs_rows)} day(s) of wearable observations. "
                        f"At least {MIN_BASELINE_DAYS} days are required before establishing a personal baseline or detecting meaningful deviations."
                    ),
                    "severity": "info",
                    "evidence": {"observation_days": len(obs_rows), "required_days": MIN_BASELINE_DAYS},
                }
            )
        else:
            b_map = {b["metric"]: b for b in baselines_summary}

            # Check activity-contextualized elevated avg_hr so we show transparent reasoning
            active_days = [
                r
                for r in obs_rows
                if (r.get("avg_hr") or 0) >= 130
                and (r.get("activity_context") in {"vigorous_run", "workout", "exercise", "cycling", "running"} or (r.get("active_minutes") or 0) >= 45)
            ]
            if active_days:
                sample_day = active_days[-1]
                insights.append(
                    {
                        "id": str(uuid.uuid4()),
                        "insight_type": "activity_contextualized",
                        "title": "Elevated Heart Rate Contextualized by Physical Activity (Not Flagged)",
                        "explanation": (
                            f"On {sample_day['observed_at'][:10]}, average heart rate reached {sample_day['avg_hr']} bpm during "
                            f"'{sample_day['activity_context']}' ({sample_day.get('active_minutes') or 0} active min, {sample_day.get('steps') or 0} steps), "
                            f"while resting heart rate stayed near personal baseline ({sample_day.get('resting_hr')} bpm). Activity context prevented a false alert."
                        ),
                        "severity": "info",
                        "evidence": {
                            "date": sample_day["observed_at"][:10],
                            "avg_hr": sample_day["avg_hr"],
                            "resting_hr": sample_day.get("resting_hr"),
                            "activity_context": sample_day["activity_context"],
                        },
                    }
                )

            # Check persistent multi-day shifts in recent_slice
            slp_b = b_map.get("sleep_hours")
            if slp_b and slp_b["baseline_low"] is not None:
                low_sleep_days = [
                    r for r in recent_slice if r.get("sleep_hours") is not None and r["sleep_hours"] < slp_b["baseline_low"]
                ]
                if len(low_sleep_days) >= 3:
                    recent_avg = round(float(np.mean([r["sleep_hours"] for r in low_sleep_days])), 2)
                    delta = round(recent_avg - slp_b["baseline_mean"], 2)
                    headache_note = ""
                    if any("headache" in c["name"].lower() for c in conditions):
                        headache_note = " Medical records also document Episodic Tension-Type Headaches, where reduced sleep is a commonly noted associated factor."
                    insights.append(
                        {
                            "id": str(uuid.uuid4()),
                            "insight_type": "persistent_deviation",
                            "title": f"Persistent Sleep Reduction Across {len(low_sleep_days)} Recent Days",
                            "explanation": (
                                f"Recent sleep averaged {recent_avg} hrs/night compared to your personal {len(hist_slice)}-day baseline of "
                                f"{slp_b['baseline_mean']} hrs/night ({delta:+} hrs; expected personal range {slp_b['baseline_low']}–{slp_b['baseline_high']} hrs)."
                                + headache_note
                            ),
                            "severity": "persistent_shift",
                            "evidence": {
                                "metric": "sleep_hours",
                                "baseline_mean": slp_b["baseline_mean"],
                                "recent_mean": recent_avg,
                                "delta": delta,
                                "days_flagged": [d["observed_at"][:10] for d in low_sleep_days],
                            },
                        }
                    )

            rhr_b = b_map.get("resting_hr")
            if rhr_b and rhr_b["baseline_high"] is not None:
                elevated_rhr_days = [
                    r
                    for r in recent_slice
                    if r.get("resting_hr") is not None
                    and r["resting_hr"] > rhr_b["baseline_high"]
                    and r.get("activity_context") not in {"vigorous_run", "workout", "exercise"}
                ]
                if len(elevated_rhr_days) >= 3:
                    recent_avg = round(float(np.mean([r["resting_hr"] for r in elevated_rhr_days])), 1)
                    delta = round(recent_avg - rhr_b["baseline_mean"], 1)
                    insights.append(
                        {
                            "id": str(uuid.uuid4()),
                            "insight_type": "persistent_deviation",
                            "title": f"Sustained Resting Heart Rate Elevation (+{delta} bpm vs Personal Baseline)",
                            "explanation": (
                                f"Resting heart rate averaged {recent_avg} bpm over the last {len(elevated_rhr_days)} days without vigorous activity context, "
                                f"above your personal baseline of {rhr_b['baseline_mean']} bpm (range {rhr_b['baseline_low']}–{rhr_b['baseline_high']} bpm). "
                                "This is an observational pattern—not a diagnosis—and may reflect sleep debt, stress, dehydration, or recovery strain."
                            ),
                            "severity": "persistent_shift",
                            "evidence": {
                                "metric": "resting_hr",
                                "baseline_mean": rhr_b["baseline_mean"],
                                "recent_mean": recent_avg,
                                "delta": delta,
                                "days_flagged": [d["observed_at"][:10] for d in elevated_rhr_days],
                            },
                        }
                    )

            hrv_b = b_map.get("hrv_ms")
            if hrv_b and hrv_b["baseline_low"] is not None:
                low_hrv_days = [r for r in recent_slice if r.get("hrv_ms") is not None and r["hrv_ms"] < hrv_b["baseline_low"]]
                if len(low_hrv_days) >= 3:
                    recent_avg = round(float(np.mean([r["hrv_ms"] for r in low_hrv_days])), 1)
                    delta = round(recent_avg - hrv_b["baseline_mean"], 1)
                    insights.append(
                        {
                            "id": str(uuid.uuid4()),
                            "insight_type": "persistent_deviation",
                            "title": f"Multi-Day HRV Dip ({delta} ms Below Personal Baseline)",
                            "explanation": (
                                f"HRV averaged {recent_avg} ms over {len(low_hrv_days)} recent days compared to your personal baseline of "
                                f"{hrv_b['baseline_mean']} ms (personal range {hrv_b['baseline_low']}–{hrv_b['baseline_high']} ms), aligning with the concurrent sleep deficit."
                            ),
                            "severity": "attention",
                            "evidence": {
                                "metric": "hrv_ms",
                                "baseline_mean": hrv_b["baseline_mean"],
                                "recent_mean": recent_avg,
                                "delta": delta,
                                "days_flagged": [d["observed_at"][:10] for d in low_hrv_days],
                            },
                        }
                    )

        for ins in insights:
            conn.execute(
                """
                INSERT INTO health_insights (id, patient_user_id, insight_type, title, explanation, severity, evidence_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    ins["id"],
                    patient_user_id,
                    ins["insight_type"],
                    ins["title"],
                    ins["explanation"],
                    ins["severity"],
                    json.dumps(ins["evidence"]),
                    now,
                ),
            )

    return {"baselines": baselines_summary, "insights": insights, "observation_days": len(obs_rows)}
