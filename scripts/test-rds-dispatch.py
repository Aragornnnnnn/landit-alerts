# RDS 발송기를 실제 웹훅에 연결하지 않고 요청과 응답 처리 계약을 검사한다.
import importlib.util
import io
import json
from pathlib import Path
import unittest
from urllib.error import URLError

MODULE = Path(__file__).resolve().parents[1] / "rds" / "dispatch-webhooks.py"
spec = importlib.util.spec_from_file_location("dispatch_webhooks", MODULE)
dispatcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatcher)


class Reply(io.BytesIO):
    status = 200


class DispatcherTest(unittest.TestCase):
    def test_success_uses_expected_auth_header_and_ignores_unrelated_ack(self):
        class Success:
            def open(self, req, timeout):
                assert timeout == 10
                assert req.full_url == "https://landit-alerts.vercel.app/api/feedback"
                assert req.get_header("X-feedback-secret") == "synthetic"
                return Reply(b'{"accepted":true}')

        self.assertEqual(dispatcher.send_webhook(Success(), "feedback", {}, "synthetic"), (200, True))

    def test_network_failure_is_unknown(self):
        class Failure:
            def open(self, req, timeout):
                raise URLError("synthetic")

        self.assertEqual(dispatcher.send_webhook(Failure(), "referral", {}, "synthetic"), (None, False))

    def test_risk_scan_failure_does_not_skip_a_committed_feedback(self):
        statements = []

        def execute(query):
            statements.append(query)
            if "scan_referral_risk" in query:
                raise RuntimeError("synthetic")
            if len(statements) == 2:
                return json.dumps({"id": 5, "channel": "feedback", "payload": {"record": {"id": 22}}})
            return ""

        class Success:
            def open(self, req, timeout):
                return Reply(b'{"accepted":true}')

        env = {
            "FEEDBACK_WEBHOOK_SECRET": "synthetic", "REFERRAL_WEBHOOK_SECRET": "synthetic",
            "SURVEY_WEBHOOK_SECRET": "synthetic",
        }
        with self.assertRaises(RuntimeError):
            dispatcher.run(execute, Success(), env)
        self.assertIn("SELECT landit_alerts.finish_webhook(5,200,true);", statements)


if __name__ == "__main__":
    unittest.main()
