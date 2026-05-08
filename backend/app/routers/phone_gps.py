"""Phone-as-GPS-source bridge.

Flow:
  1. Laptop dashboard generates a sessionId and opens a WS to /api/ws/phone-gps/{sid}
  2. Laptop shows a QR code linking to /phone-gps/{sid}
  3. Phone opens that page, reads navigator.geolocation, POSTs fixes here
  4. Each POST is fanned out to every laptop subscribed to the same sid

The sessionId is the only secret — it's a 128-bit random string generated
client-side and shown briefly via QR. No JWT auth on the POST/WS so the phone
doesn't need to log in. Treat sessionId like a one-time pairing code.
"""
import asyncio
import json
import re
import socket
import time
from collections import defaultdict

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field

router = APIRouter(tags=["phone-gps"])

# sessionId -> [WebSocket, ...] (laptop dashboard subscribers)
_subscribers: dict[str, list[WebSocket]] = defaultdict(list)
# sessionId -> last fix payload, so a freshly-connecting laptop sees the
# latest position without waiting for the next phone tick.
_last_fix: dict[str, dict] = {}
_lock = asyncio.Lock()

# sessionId format: alphanumeric + hyphens, 16-64 chars (matches crypto.randomUUID
# and other reasonable pairing tokens). Anything else is rejected.
_SID_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class GPSFix(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    accuracy: float | None = None
    heading: float | None = None
    speed: float | None = None


def _validate_sid(sid: str) -> None:
    if not _SID_RE.match(sid or ""):
        raise HTTPException(status_code=400, detail="Invalid session id")


def _detect_lan_ips() -> list[str]:
    """Return non-loopback IPv4 addresses for this host so the frontend can
    build a QR URL the phone can actually reach. The laptop's `localhost`
    isn't reachable from the phone — we need the LAN IP (e.g., 192.168.x.x).
    """
    ips: list[str] = []
    # Most reliable: open a UDP socket "to" a public address (no packets are
    # sent on connect for UDP) and read the local socket's bound address —
    # that's the IP this host would use to reach the network.
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                ips.append(ip)
        finally:
            s.close()
    except Exception:
        pass
    # Hostname-based lookup as a fallback (covers multi-NIC setups).
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    return ips


@router.get("/api/phone-gps/host-info")
def host_info():
    """Used by the frontend pairing modal to swap `localhost` for a real
    LAN IP in the QR-encoded URL. Best-effort: returns whatever non-loopback
    IPv4 addresses the host can see."""
    return {"ips": _detect_lan_ips()}


@router.post("/api/phone-gps/{session_id}")
async def post_fix(session_id: str, fix: GPSFix):
    """Phone posts a GPS fix; broadcast to all laptop subscribers on this session."""
    _validate_sid(session_id)
    payload = {
        "lat": fix.lat,
        "lng": fix.lng,
        "accuracy": fix.accuracy,
        "heading": fix.heading,
        "speed": fix.speed,
        "ts": int(time.time() * 1000),
    }
    async with _lock:
        _last_fix[session_id] = payload
        subs = list(_subscribers.get(session_id, []))
    message = json.dumps({"type": "phone_gps_fix", "data": payload})
    delivered = 0
    for ws in subs:
        try:
            await ws.send_text(message)
            delivered += 1
        except Exception:
            pass
    return {"ok": True, "delivered": delivered}


@router.websocket("/api/ws/phone-gps/{session_id}")
async def subscribe_ws(ws: WebSocket, session_id: str):
    """Laptop subscribes here; receives every fix posted to the same sessionId."""
    if not _SID_RE.match(session_id or ""):
        await ws.close(code=4400, reason="Invalid session id")
        return
    await ws.accept()
    async with _lock:
        _subscribers[session_id].append(ws)
        last = _last_fix.get(session_id)
    try:
        await ws.send_text(json.dumps({"type": "phone_gps_ready", "data": {"session_id": session_id}}))
        if last is not None:
            await ws.send_text(json.dumps({"type": "phone_gps_fix", "data": last}))
        # Keep the socket open; we don't expect inbound messages from the laptop,
        # but receive_text() is the standard way to detect a clean disconnect.
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        async with _lock:
            if ws in _subscribers.get(session_id, []):
                _subscribers[session_id].remove(ws)
            if not _subscribers.get(session_id):
                _subscribers.pop(session_id, None)
                _last_fix.pop(session_id, None)
