import io
import json
import logging
import re
from typing import Any

from pypdf import PdfReader

from app import config

logger = logging.getLogger("medisync.pdf_extractor")


def extract_text_from_pdf_bytes(file_bytes: bytes, filename: str) -> tuple[str, list[tuple[int, str]]]:
    """Extract text page-by-page from a PDF (or plain text file fallback). Returns (full_text, [(page_num, page_text)])."""
    if filename.lower().endswith(".txt"):
        txt = file_bytes.decode("utf-8", errors="replace")
        return txt, [(1, txt)]

    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[tuple[int, str]] = []
    for idx, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        if text:
            pages.append((idx, text))
    full_text = "\n\n".join(f"[Page {p}]\n{t}" for p, t in pages)
    return full_text, pages


_LAB_LINE_RE = re.compile(
    r"^(?:Lab\s*Result:\s*)?(?P<name>[A-Za-z0-9\s\-\(\)/]+?)\s*(?:=|:)\s*(?P<value>[0-9]+(?:\.[0-9]+)?(?:/[0-9]+(?:\.[0-9]+)?)?)\s*(?P<unit>[A-Za-z/%]+(?:/[A-Za-z]+)?)?(?:\s*\[Ref:\s*(?P<ref>[^\]]+)\])?(?:\s*\((?P<flag>[^)]+)\))?$",
    re.IGNORECASE,
)

_COMMON_LAB_KEYWORDS = (
    "vitamin d",
    "tsh",
    "hba1c",
    "hemoglobin",
    "glucose",
    "cholesterol",
    "ldl",
    "hdl",
    "triglyceride",
    "creatinine",
    "bp",
    "blood pressure",
    "ferritin",
    "b12",
)


def _extract_entities_rule_based(pages: list[tuple[int, str]], filename: str, fallback_date: str | None) -> list[dict[str, Any]]:
    """Fallback regex parser used ONLY when GROQ_API_KEY is absent or the Groq API fails."""
    entities: list[dict[str, Any]] = []
    detected_date = fallback_date

    for page_num, page_text in pages:
        for line_num, raw_line in enumerate(page_text.splitlines(), start=1):
            line = raw_line.strip()
            if not line:
                continue

            date_match = re.search(r"(?:Report\s*Date|Prescription\s*Date|Date)\s*:\s*(\d{4}-\d{2}-\d{2})", line, re.IGNORECASE)
            if date_match:
                detected_date = date_match.group(1)
                continue

            src_ref = f"{filename} · Page {page_num}, Line {line_num}"
            lower = line.lower()

            if lower.startswith("condition:") or lower.startswith("diagnosis:"):
                val = line.split(":", 1)[1].strip()
                if val:
                    entities.append({
                        "category": "condition",
                        "name": val,
                        "value": "Documented",
                        "observed_date": detected_date,
                        "source_reference": src_ref,
                        "confidence": 0.90,
                    })
                continue

            if lower.startswith("allergy:") or lower.startswith("allergies:"):
                val = line.split(":", 1)[1].strip()
                if val and val.lower() != "none":
                    entities.append({
                        "category": "allergy",
                        "name": val,
                        "value": "Reported allergy",
                        "observed_date": detected_date,
                        "source_reference": src_ref,
                        "confidence": 0.90,
                    })
                continue

            if lower.startswith("medication:") or lower.startswith("rx:"):
                val = line.split(":", 1)[1].strip()
                parts = [p.strip() for p in val.split(" - ", 1)]
                entities.append({
                    "category": "medication",
                    "name": parts[0],
                    "value": parts[1] if len(parts) > 1 else "Prescribed",
                    "observed_date": detected_date,
                    "source_reference": src_ref,
                    "confidence": 0.88,
                })
                continue

            if lower.startswith("observation:"):
                val = line.split(":", 1)[1].strip()
                entities.append({
                    "category": "observation",
                    "name": "Clinical Observation",
                    "value": val,
                    "observed_date": detected_date,
                    "source_reference": src_ref,
                    "confidence": 0.85,
                })
                continue

            if lower.startswith("event:"):
                val = line.split(":", 1)[1].strip()
                entities.append({
                    "category": "event",
                    "name": "Care Event",
                    "value": val,
                    "observed_date": detected_date,
                    "source_reference": src_ref,
                    "confidence": 0.85,
                })
                continue

            if lower.startswith("lab result:") or any(kw in lower for kw in _COMMON_LAB_KEYWORDS):
                m = _LAB_LINE_RE.match(line)
                if m:
                    entities.append({
                        "category": "lab_result",
                        "name": m.group("name").strip(),
                        "value": m.group("value").strip(),
                        "unit": (m.group("unit") or "").strip() or None,
                        "reference_range": (m.group("ref") or "").strip() or None,
                        "flag": (m.group("flag") or "Normal").strip(),
                        "observed_date": detected_date,
                        "source_reference": src_ref,
                        "confidence": 0.88,
                    })
                    continue

            med_match = re.match(r"^([A-Z][A-Za-z0-9\-\s]{2,35})\s+(\d+\s*(?:mg|mcg|IU|ml|g)\b.*)$", line)
            if med_match:
                entities.append({
                    "category": "medication",
                    "name": med_match.group(1).strip(),
                    "value": med_match.group(2).strip(),
                    "observed_date": detected_date,
                    "source_reference": src_ref,
                    "confidence": 0.82,
                })

    return entities


def _parse_groq_structured_payload(parsed: dict[str, Any], filename: str, fallback_date: str | None) -> list[dict[str, Any]]:
    entities: list[dict[str, Any]] = []
    doc_date = parsed.get("document_date") or fallback_date

    for cond in parsed.get("conditions", []) or []:
        if isinstance(cond, str):
            name, val, quote, conf = cond.strip(), "Documented", "", 0.90
        elif isinstance(cond, dict):
            name = str(cond.get("name") or "").strip()
            val = str(cond.get("status") or cond.get("value") or "Documented").strip()
            quote = str(cond.get("source_quote") or "").strip()
            conf = float(cond.get("confidence", 0.92))
        else:
            continue
        if name:
            entities.append({
                "category": "condition",
                "name": name[:160],
                "value": val[:240],
                "observed_date": (cond.get("observed_date") if isinstance(cond, dict) else None) or doc_date,
                "source_reference": f"{filename} · Groq LLM" + (f" ({quote[:70]})" if quote else ""),
                "confidence": conf,
            })

    for med in parsed.get("medications", []) or []:
        if isinstance(med, str):
            name, val, quote, conf = med.strip(), "Prescribed", "", 0.90
        elif isinstance(med, dict):
            name = str(med.get("name") or "").strip()
            parts = [str(med.get(k) or "").strip() for k in ("dosage", "frequency", "instructions") if med.get(k)]
            val = " · ".join(parts) if parts else str(med.get("value") or "Prescribed")
            quote = str(med.get("source_quote") or "").strip()
            conf = float(med.get("confidence", 0.92))
        else:
            continue
        if name:
            entities.append({
                "category": "medication",
                "name": name[:160],
                "value": val[:240],
                "observed_date": (med.get("observed_date") if isinstance(med, dict) else None) or doc_date,
                "source_reference": f"{filename} · Groq LLM" + (f" ({quote[:70]})" if quote else ""),
                "confidence": conf,
            })

    for alg in parsed.get("allergies", []) or []:
        if isinstance(alg, str):
            name, val, quote, conf = alg.strip(), "Reported allergy", "", 0.92
        elif isinstance(alg, dict):
            name = str(alg.get("name") or "").strip()
            val = str(alg.get("reaction") or alg.get("value") or "Reported allergy").strip()
            quote = str(alg.get("source_quote") or "").strip()
            conf = float(alg.get("confidence", 0.94))
        else:
            continue
        if name:
            entities.append({
                "category": "allergy",
                "name": name[:160],
                "value": val[:240],
                "observed_date": (alg.get("observed_date") if isinstance(alg, dict) else None) or doc_date,
                "source_reference": f"{filename} · Groq LLM" + (f" ({quote[:70]})" if quote else ""),
                "confidence": conf,
            })

    for lab in parsed.get("lab_results", []) or []:
        if not isinstance(lab, dict):
            continue
        name = str(lab.get("name") or "").strip()
        if not name:
            continue
        quote = str(lab.get("source_quote") or "").strip()
        entities.append({
            "category": "lab_result",
            "name": name[:160],
            "value": str(lab.get("value") if lab.get("value") is not None else "")[:120] or None,
            "unit": str(lab.get("unit") or "").strip() or None,
            "reference_range": str(lab.get("reference_range") or "").strip() or None,
            "flag": str(lab.get("flag") or "Normal").strip(),
            "observed_date": lab.get("observed_date") or doc_date,
            "source_reference": f"{filename} · Groq LLM" + (f" ({quote[:70]})" if quote else ""),
            "confidence": float(lab.get("confidence", 0.93)),
        })

    for note in parsed.get("clinical_notes", []) or []:
        if isinstance(note, str):
            title, summary, cat, quote, conf = "Clinical Note", note.strip(), "observation", "", 0.86
        elif isinstance(note, dict):
            summary = str(note.get("summary") or note.get("value") or "").strip()
            title = str(note.get("title") or note.get("name") or "Clinical Note").strip()
            cat = note.get("category") if note.get("category") in {"observation", "event"} else "observation"
            quote = str(note.get("source_quote") or "").strip()
            conf = float(note.get("confidence", 0.88))
        else:
            continue
        if summary:
            # Never duplicate the exact same string in name and value
            if title == summary:
                title = "Clinical Follow-up Note" if cat == "event" else "Clinical Observation"
            entities.append({
                "category": cat,
                "name": title[:160],
                "value": summary[:240],
                "observed_date": (note.get("observed_date") if isinstance(note, dict) else None) or doc_date,
                "source_reference": f"{filename} · Groq LLM" + (f" ({quote[:70]})" if quote else ""),
                "confidence": conf,
            })

    # Support legacy flat "items" array if returned
    for item in parsed.get("items", []) or []:
        if isinstance(item, dict) and item.get("category") in {"condition", "medication", "allergy", "lab_result", "observation", "event"} and item.get("name"):
            entities.append({
                "category": item["category"],
                "name": str(item["name"])[:160],
                "value": str(item.get("value") or "")[:240] or None,
                "unit": item.get("unit"),
                "reference_range": item.get("reference_range"),
                "flag": item.get("flag"),
                "observed_date": item.get("observed_date") or doc_date,
                "source_reference": f"{filename} · Groq LLM",
                "confidence": float(item.get("confidence", 0.88)),
            })

    return entities


def _extract_with_groq(full_text: str, filename: str, fallback_date: str | None) -> list[dict[str, Any]]:
    from groq import Groq

    logger.info("Extracting structured medical entities via Groq (%s) for %s", config.GROQ_MODEL, filename)
    client = Groq(api_key=config.GROQ_API_KEY)
    prompt = (
        "Extract ONLY explicitly stated medical information from this document. "
        "Never fabricate or guess unstated diagnoses, doses, or lab values.\n"
        "Return a valid JSON object with these exact keys:\n"
        "- document_date: YYYY-MM-DD or null\n"
        "- conditions: [{name, status, observed_date, source_quote, confidence}]\n"
        "- medications: [{name, dosage, frequency, instructions, observed_date, source_quote, confidence}]\n"
        "- allergies: [{name, reaction, observed_date, source_quote, confidence}]\n"
        "- lab_results: [{name, value, unit, reference_range, flag, observed_date, source_quote, confidence}] "
        "(flag must be one of Normal, Low, High, Borderline, Abnormal)\n"
        "- clinical_notes: [{title, summary, category, observed_date, source_quote, confidence}] "
        "(use short descriptive titles like 'Headache Pattern' or '6-Week Repeat Labs', NEVER duplicate the full summary into title)\n\n"
        f"Document filename: {filename}\n"
        f"Document text:\n{full_text[:10000]}"
    )
    resp = client.chat.completions.create(
        model=config.GROQ_MODEL,
        temperature=0.1,
        response_format={"type": "json_object"},
        messages=[
            {
                "role": "system",
                "content": "You are a strict clinical document extraction engine. Output valid JSON only, grounded strictly in the provided text.",
            },
            {"role": "user", "content": prompt},
        ],
    )
    raw_json = resp.choices[0].message.content or "{}"
    parsed = json.loads(raw_json)
    return _parse_groq_structured_payload(parsed, filename, fallback_date)


def extract_medical_entities(
    full_text: str,
    filename: str,
    fallback_date: str | None = None,
    pages: list[tuple[int, str]] | None = None,
    use_llm: bool = True,
) -> list[dict[str, Any]]:
    """
    Extract structured clinical information from text without fabricating missing details.
    Uses Groq Structured JSON whenever GROQ_API_KEY is configured; falls back to regex ONLY if GROQ_API_KEY is absent or Groq fails.
    """
    if pages is None:
        pages = [(1, full_text)]

    if use_llm and config.HAS_GROQ and full_text.strip():
        try:
            groq_entities = _extract_with_groq(full_text, filename, fallback_date)
            if groq_entities:
                return groq_entities
            logger.warning("Groq returned 0 structured entities for %s; falling back to rule-based parser.", filename)
        except Exception as exc:
            logger.error("Groq PDF extraction failed for %s (%s): %s", filename, config.GROQ_MODEL, exc, exc_info=True)
    elif use_llm and not config.HAS_GROQ:
        logger.info("GROQ_API_KEY not configured; using rule-based medical extraction for %s.", filename)

    return _extract_entities_rule_based(pages, filename, fallback_date)
