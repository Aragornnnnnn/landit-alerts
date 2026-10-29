# OpenAI 보고용 비밀값을 화면에 표시하지 않고 로컬 전용 환경 파일에 저장한다.
import getpass
import os
from pathlib import Path
import re
import tempfile

path = Path(__file__).resolve().parent.parent / '.env.openai'
values = {}
if path.exists():
    for line in path.read_text().splitlines():
        if '=' in line and not line.startswith('#'):
            name, value = line.split('=', 1)
            values[name] = value

settings = [
    ('OPENAI_ADMIN_KEY', 'OpenAI Admin API key', r'sk-admin-[A-Za-z0-9_-]+', True),
    ('OPENAI_ORG_ID', 'OpenAI 조직 ID', r'org-[A-Za-z0-9]+', False),
    ('DISCORD_WEBHOOK_OPENAI', 'Discord 웹훅 URL', r'https://discord\.com/api/webhooks/[0-9]+/[A-Za-z0-9_-]+', True),
]
for name, label, pattern, secret in settings:
    if re.fullmatch(pattern, values.get(name, '')):
        print(f'{name}: 기존 설정 유지.')
        continue
    value = (getpass.getpass(f'{label} (입력 숨김): ') if secret else input(f'{label}: ')).strip()
    if not re.fullmatch(pattern, value):
        raise SystemExit(f'{name}: 형식 오류. 파일을 변경하지 않았습니다.')
    values[name] = value

fd, temp = tempfile.mkstemp(prefix='.env.openai.', dir=path.parent)
try:
    with os.fdopen(fd, 'w') as out:
        out.write(''.join(f'{name}={values[name]}\n' for name, *_ in settings))
    os.replace(temp, path)
finally:
    if os.path.exists(temp):
        os.unlink(temp)
print('로컬 .env.openai 저장 완료. 비밀값은 출력하지 않았습니다.')
