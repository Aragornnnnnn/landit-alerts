#!/usr/bin/env python3
# RDS에 기록된 알림을 기존 Vercel 수신기로 한 번만 전달한다.
import json
import os
import subprocess
from urllib import error, request

BASE_URL = "https://landit-alerts.vercel.app/api"
CHANNELS = {
    "feedback": ("x-feedback-secret", "FEEDBACK_WEBHOOK_SECRET", "accepted"),
    "referral": ("x-referral-secret", "REFERRAL_WEBHOOK_SECRET", "sent"),
    "survey": ("x-survey-secret", "SURVEY_WEBHOOK_SECRET", "sent"),
}


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # 인증 헤더가 다른 호스트에 전달되지 않도록 리다이렉트를 거부한다.
        return None


def psql(query):
    result = subprocess.run(
        ["psql", "-XAtq", "-w", "-v", "ON_ERROR_STOP=1"],
        input=query,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        timeout=25,
        check=False,
    )
    if result.returncode:
        raise RuntimeError("webhook database operation failed")
    return result.stdout.strip()


def send_webhook(opener, channel, payload, secret):
    header, _, ack_field = CHANNELS[channel]
    outbound = request.Request(
        f"{BASE_URL}/{channel}",
        data=json.dumps(payload, separators=(",", ":")).encode(),
        headers={"Content-Type": "application/json", header: secret},
        method="POST",
    )
    try:
        with opener.open(outbound, timeout=10) as response:
            status = response.status
            try:
                body = json.loads(response.read(65536))
            except (ValueError, UnicodeError):
                body = None
            acknowledged = isinstance(body, dict) and body.get(ack_field) is True
            return status, acknowledged
    except error.HTTPError as exc:
        exc.close()
        return exc.code, False
    except (OSError, error.URLError):
        return None, False


def run(execute=psql, opener=None, env=os.environ):
    secrets = {channel: env.get(config[1]) for channel, config in CHANNELS.items()}
    if any(not secret for secret in secrets.values()):
        raise RuntimeError("webhook authentication is not configured")
    if opener is None:
        opener = request.build_opener(NoRedirect())
    scan_error = None
    try:
        execute("SELECT landit_alerts.scan_referral_risk();")
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        scan_error = exc
    for _ in range(20):
        raw = execute("SELECT row_to_json(q) FROM landit_alerts.claim_webhook() q;")
        if not raw:
            break
        job = json.loads(raw)
        event_id = int(job["id"])
        channel = job["channel"]
        status, sent = send_webhook(opener, channel, job["payload"], secrets[channel])
        result_status = "NULL" if status is None else str(int(status))
        result_sent = "true" if sent else "false"
        execute(f"SELECT landit_alerts.finish_webhook({event_id},{result_status},{result_sent});")
        print(f"webhook id={event_id} channel={channel} http_status={status} acknowledged={sent}")
    if scan_error is not None:
        raise scan_error


if __name__ == "__main__":
    try:
        run()
    except (RuntimeError, subprocess.TimeoutExpired) as exc:
        raise SystemExit(f"Webhook dispatcher failed: {type(exc).__name__}") from None
