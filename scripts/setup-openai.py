# OpenAI 보고용 비밀값을 숨김 입력으로 받아 비용 조회 권한을 확인한 뒤 저장한다.
import getpass
import json
import os
from pathlib import Path
import re
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

SETTINGS = [
    ('OPENAI_ADMIN_KEY', 'OpenAI Admin API key', r'[A-Za-z0-9._~+/-]+=*', True),
    ('OPENAI_ORG_ID', 'OpenAI 조직 ID', r'org-[A-Za-z0-9]+', False),
    ('DISCORD_WEBHOOK_OPENAI', 'Discord 웹훅 URL', r'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+', True),
]


def normalize(value):
    value = value.strip()
    if len(value) >= 2 and (value[0], value[-1]) in [('"', '"'), ("'", "'"), ('“', '”'), ('‘', '’')]:
        value = value[1:-1].strip()
    return value


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_access(values):
    end = int(time.time()) // 86400 * 86400
    query = urllib.parse.urlencode({'start_time': end - 86400, 'end_time': end, 'limit': 1})
    request = urllib.request.Request(
        'https://api.openai.com/v1/organization/costs?' + query,
        headers={'Authorization': 'Bearer ' + values['OPENAI_ADMIN_KEY'],
                 'OpenAI-Organization': values['OPENAI_ORG_ID']},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=20) as response:
            payload = json.load(response)
            if not isinstance(payload, dict) or not isinstance(payload.get('data'), list):
                raise ValueError('Unexpected response')
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            raise ValueError(
                f'OpenAI 비용 조회 권한 확인 실패 (HTTP {error.code}). '
                '대상 조직의 Admin keys에서 발급한 전체 비밀 키인지 확인하세요. '
                '일반 프로젝트 키·키 ID·일부만 표시된 키로는 등록할 수 없습니다.'
            ) from None
        raise ValueError(f'OpenAI 비용 조회 확인 실패 (HTTP {error.code}). 잠시 후 다시 시도하세요.') from None
    except Exception:
        raise ValueError('OpenAI 비용 조회 연결 또는 응답 확인 실패. 네트워크·인증서 상태를 확인하고 다시 시도하세요.') from None


def setup(path):
    values = {}
    if path.exists():
        for line in path.read_text().splitlines():
            if '=' in line and not line.startswith('#'):
                name, value = line.split('=', 1)
                values[name] = value

    for name, label, pattern, secret in SETTINGS:
        current = values.get(name, '')
        if name != 'OPENAI_ADMIN_KEY' and re.fullmatch(pattern, current):
            print(f'{name}: 기존 설정 유지.')
            continue
        # 잘못되었거나 만료된 기존 키도 같은 명령으로 교체할 수 있다.
        suffix = ' (기존 키 유지: Enter)' if current else ''
        value = normalize(getpass.getpass(f'{label}{suffix} (입력 숨김): ') if secret else input(f'{label}: '))
        if not value and current:
            value = current
        if not re.fullmatch(pattern, value):
            raise ValueError(f'{name}: 빈 입력 또는 공백·허용되지 않는 문자가 있습니다. 전체 값을 다시 복사하세요.')
        if name == 'OPENAI_ADMIN_KEY' and ('...' in value or value.startswith('key_')):
            raise ValueError('키 ID나 일부만 표시된 키가 입력되었습니다. 발급 시 표시된 전체 비밀 키를 입력하세요.')
        values[name] = value

    print('OpenAI 비용 API 조회 권한 확인 중…')
    verify_access(values)
    fd, temp = tempfile.mkstemp(prefix='.env.openai.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as out:
            out.write(''.join(f'{name}={values[name]}\n' for name, *_ in SETTINGS))
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    print('비용 API 조회 확인 및 로컬 .env.openai 저장 완료. 비밀값은 출력하지 않았습니다.')


if __name__ == '__main__':
    try:
        setup(Path(__file__).resolve().parent.parent / '.env.openai')
    except ValueError as error:
        raise SystemExit(f'{error}\n파일을 변경하지 않았습니다.') from None
    except (KeyboardInterrupt, EOFError):
        raise SystemExit('\n입력을 취소했습니다. 파일을 변경하지 않았습니다.') from None
