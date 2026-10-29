# OpenRouter 숨김 입력 등록의 원자적 저장과 실패 시 기존 설정 보존을 검증한다.
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup_openrouter', Path(__file__).with_name('setup-openrouter.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class SetupOpenRouterTest(unittest.TestCase):
    def test_verified_key_is_private_and_not_printed(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.openrouter'
            with patch.object(setup.getpass, 'getpass', return_value='"test-secret"'), patch.object(setup, 'verify_access') as verify, patch('builtins.print') as output:
                setup.setup(path)
            verify.assert_called_once_with('test-secret')
            self.assertEqual(path.read_text(), 'OPENROUTER_MANAGEMENT_KEY=test-secret\n')
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertNotIn('test-secret', str(output.call_args_list))

    def test_failure_preserves_existing_key(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / '.env.openrouter'
            path.write_text('original')
            with patch.object(setup.getpass, 'getpass', return_value='new-secret'), patch.object(setup, 'verify_access', side_effect=ValueError('denied')), patch('builtins.print'):
                with self.assertRaises(ValueError):
                    setup.setup(path)
            self.assertEqual(path.read_text(), 'original')

    def test_invalid_key_does_not_make_request(self):
        with patch.object(setup.getpass, 'getpass', return_value='sk-...partial'), patch.object(setup, 'verify_access') as verify:
            with self.assertRaises(ValueError):
                setup.setup(Path('/not-used'))
            verify.assert_not_called()


if __name__ == '__main__':
    unittest.main()
