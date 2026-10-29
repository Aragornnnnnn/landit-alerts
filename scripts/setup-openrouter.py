# OpenRouter 관리 키를 숨김 입력으로 받아 조회 권한을 검증하고 로컬 파일에 안전하게 저장한다.
import getpass
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_access(key):
    request = urllib.request.Request(
        'https://openrouter.ai/api/v1/credits',
        headers={'Authorization': 'Bearer ' + key},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            data = json.load(response)['data']
            for field in ('total_credits', 'total_usage'):
                value = data[field]
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                    raise ValueError('Invalid credits')
    except urllib.error.HTTPError as error:
        raise ValueError(f'OpenRouter 조회 권한 확인 실패 (HTTP {error.code}). Aragorn 조직의 Management key인지 확인하세요.') from None
    except Exception:
        raise ValueError('OpenRouter 연결 또는 잔액 응답 확인 실패. 파일을 변경하지 않았습니다.') from None


def setup(path):
    key = getpass.getpass('Aragorn 조직 OpenRouter Management API key (입력 숨김): ').strip()
    if len(key) >= 2 and (key[0], key[-1]) in [('"', '"'), ("'", "'"), ('“', '”')]:
        key = key[1:-1].strip()
    if not re.fullmatch(r'[A-Za-z0-9._~+/-]+=*', key) or '...' in key:
        raise ValueError('전체 관리 키를 입력하세요. 공백·일부만 표시된 키는 사용할 수 없습니다.')
    print('OpenRouter 잔액 조회 권한 확인 중…')
    verify_access(key)
    fd, temporary = tempfile.mkstemp(prefix='.env.openrouter.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            output.write('OPENROUTER_MANAGEMENT_KEY=' + key + '\n')
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print('조회 확인 및 로컬 .env.openrouter 저장 완료. 비밀값은 출력하지 않았습니다.')
    print('서버 등록은 아직 하지 않았습니다. Codex 채팅에 등록 완료라고 알려주세요.')


if __name__ == '__main__':
    try:
        setup(Path(__file__).resolve().parent.parent / '.env.openrouter')
    except ValueError as error:
        raise SystemExit(str(error)) from None
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('\n입력을 취소했습니다. 파일을 변경하지 않았습니다.') from None
