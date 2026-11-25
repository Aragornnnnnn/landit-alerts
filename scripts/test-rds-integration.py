# 설문·지표 HTTP 경로의 인증 분리와 RDS 파라미터 계약을 확인한다.
from datetime import date
import sys
from pathlib import Path
import unittest

from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "rds"))
from integration_api import create_app


class IntegrationTest(unittest.TestCase):
    def setUp(self):
        self.calls = []
        self.result = "saved"

        def execute(dsn, statement, fields):
            self.calls.append((dsn, statement, fields))
            return self.result

        self.client = TestClient(create_app({
            "LANDIT_SURVEY_RDS_TOKEN": "survey-only",
            "LANDIT_METRICS_RDS_TOKEN": "metrics-only",
            "LANDIT_SURVEY_RDS_DSN": "survey-db",
            "LANDIT_METRICS_RDS_DSN": "metrics-db",
        }, execute))
        self.survey = dict(user_id=9, survey="paid", completed=False, answers={"choice": ["A"]})

    def test_survey_kind_and_progress_are_sent_to_the_narrow_function(self):
        response = self.client.post("/internal/rds/survey", json=self.survey,
                                    headers={"Authorization": "Bearer survey-only"})
        self.assertEqual(response.status_code, 204)
        dsn, statement, fields = self.calls[0]
        self.assertEqual(dsn, "survey-db")
        self.assertIn("landit_integration.save_survey", statement)
        self.assertEqual(fields[:5], (9, "paid", None, False, None))
        self.assertEqual(fields[5].obj, {"choice": ["A"]})

    def test_another_role_token_is_rejected_before_parsing(self):
        response = self.client.post("/internal/rds/survey", content=b"not-json",
                                    headers={"Authorization": "Bearer metrics-only"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.calls, [])

    def test_unknown_kind_and_response_id_conflict_are_rejected(self):
        headers = {"Authorization": "Bearer survey-only"}
        invalid = self.client.post("/internal/rds/survey",
                                   json={**self.survey, "survey": "unregistered"}, headers=headers)
        self.assertEqual(invalid.status_code, 400)
        self.assertEqual(self.calls, [])

        self.result = "response_conflict"
        conflict = self.client.post("/internal/rds/survey", json=self.survey, headers=headers)
        self.assertEqual(conflict.status_code, 409)

    def test_metrics_uses_separate_credentials_and_existing_shape(self):
        self.result = {"streak": {"top": 7, "users": [9]}, "scenarios": {"top": 2, "users": [4]}}
        response = self.client.post("/internal/rds/metrics",
                                    json={"target_date": "2026-11-26", "excluded_ids": [10]},
                                    headers={"Authorization": "Bearer metrics-only"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), self.result)
        self.assertEqual(self.calls[0][0], "metrics-db")
        self.assertEqual(self.calls[0][2], (date(2026, 11, 26), [10]))


if __name__ == "__main__":
    unittest.main()
