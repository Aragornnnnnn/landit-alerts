# 비밀값을 노출하지 않는 등록·조회 실패·기존 파일 보존을 검증한다.
import contextlib
import importlib.util
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import urllib.error

spec = importlib.util.spec_from_file_location('setup_openai', Path(__file__).with_name('setup-openai.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupTest(unittest.TestCase):
    def test_normalize_quotes_and_keep_bearer_characters(self):
        self.assertEqual(setup.normalize(' “sk-new-format.a/b+_~==” '), 'sk-new-format.a/b+_~==')

    def run_setup(self, verify_error=None, key='"sk-new-format.a/b+_~=="'):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.openai'
            original = 'OPENAI_ADMIN_KEY=\nOPENAI_ORG_ID=org-test\nDISCORD_WEBHOOK_OPENAI=https://discord.com/api/webhooks/123/test\n'
            path.write_text(original)
            stdout = io.StringIO()
            with patch.object(setup.getpass, 'getpass', return_value=key), patch.object(setup, 'verify_access', side_effect=verify_error) as verify, contextlib.redirect_stdout(stdout):
                if verify_error:
                    with self.assertRaises(ValueError):
                        setup.setup(path)
                    self.assertEqual(path.read_text(), original)
                else:
                    setup.setup(path)
                    self.assertEqual(verify.call_args.args[0]['OPENAI_ADMIN_KEY'], setup.normalize(key))
                    self.assertIn('OPENAI_ADMIN_KEY=sk-new-format.a/b+_~==\n', path.read_text())
                    self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('sk-new-format', stdout.getvalue())

    def test_accept_supported_bearer_token_after_api_check(self):
        self.run_setup()

    def test_failed_api_check_preserves_existing_file(self):
        self.run_setup(ValueError('권한 없음'))

    def test_http_failure_does_not_disclose_body_or_key(self):
        error = urllib.error.HTTPError('https://api.openai.com', 403, 'SECRET', {}, io.BytesIO(b'SECRET'))
        with patch.object(setup.urllib.request, 'build_opener') as opener:
            opener.return_value.open.side_effect = error
            with self.assertRaises(ValueError) as captured:
                setup.verify_access({'OPENAI_ADMIN_KEY': 'SECRET', 'OPENAI_ORG_ID': 'org-test'})
        self.assertIn('403', str(captured.exception))
        self.assertNotIn('SECRET', str(captured.exception))

    def test_masked_or_id_values_fail_before_request(self):
        for key in ['key_abc', 'sk-admin...abc', 'sk-a\nEVIL=value']:
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                path = Path(directory) / '.env.openai'
                with patch.object(setup.getpass, 'getpass', return_value=key), patch.object(setup, 'verify_access') as verify:
                    with self.assertRaises(ValueError):
                        setup.setup(path)
                verify.assert_not_called()
                self.assertFalse(path.exists())


if __name__ == '__main__':
    unittest.main()
