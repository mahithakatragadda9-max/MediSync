import base64
import io

import qrcode


def build_privacy_safe_qr_payload(medisync_id: str) -> str:
    """
    CRITICAL PRIVACY RULE:
    Encode ONLY the opaque MediSync ID lookup URI.
    Never encode patient name, phone number, DOB, conditions, prescriptions, or reports.
    """
    return f"medisync://lookup/{medisync_id}"


def generate_qr_png_bytes(medisync_id: str) -> bytes:
    payload = build_privacy_safe_qr_payload(medisync_id)
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_M,
        box_size=8,
        border=3,
    )
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0f2942", back_color="#ffffff")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def generate_qr_data_uri(medisync_id: str) -> str:
    png = generate_qr_png_bytes(medisync_id)
    b64 = base64.b64encode(png).decode("ascii")
    return f"data:image/png;base64,{b64}"
