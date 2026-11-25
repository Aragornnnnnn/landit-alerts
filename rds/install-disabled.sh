#!/usr/bin/env bash
# 전환 EC2에 설문·지표 API와 알림 타이머를 설치하되 시작하지 않는다.
set -euo pipefail
umask 077

source_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
runtime_dir=/opt/landit/alerts
unit_dir=/etc/systemd/system
revision=${1:-}
units=(landit-rds-integration.service landit-alerts.service landit-alerts.timer)

if [[ $EUID != 0 || ! "$revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo 'root 권한과 설치 대상 Git SHA가 필요합니다.' >&2
  exit 2
fi

for unit in "${units[@]}"; do
  mode=$(systemctl show -p UnitFileState --value "$unit")
  if systemctl is-active --quiet "$unit" || [[ -n "$mode" && "$mode" != disabled && "$mode" != static ]]; then
    echo "$unit 실행 또는 자동 시작 설정을 확인하세요." >&2
    exit 1
  fi
  if [[ -f "$unit_dir/$unit" ]] && ! cmp -s "$source_dir/$unit" "$unit_dir/$unit"; then
    echo "$unit 기존 파일을 보존했습니다. 설정 차이를 확인하세요." >&2
    exit 1
  fi
done

if ! command -v python3.11 >/dev/null || ! python3.11 -m pip --version >/dev/null 2>&1; then
  dnf install -y python3.11 python3.11-pip > /var/log/landit-alerts-python-install.log 2>&1 || {
    echo 'Python 3.11 설치에 실패했습니다. 호스트 로그를 확인하세요.' >&2
    exit 1
  }
fi

install -d -m 0755 "$runtime_dir"
python3.11 -m venv "$runtime_dir/venv"
PIP_DISABLE_PIP_VERSION_CHECK=1 "$runtime_dir/venv/bin/python" -m pip install \
  -r "$source_dir/integration-requirements.txt" > "$runtime_dir/install.log" 2>&1 || {
    echo '연동 서비스 의존성 설치에 실패했습니다. 호스트 로그를 확인하세요.' >&2
    exit 1
  }
"$runtime_dir/venv/bin/python" -m pip check
install -m 0644 "$source_dir/integration_api.py" "$source_dir/dispatch-webhooks.py" "$runtime_dir/"
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH="$runtime_dir" "$runtime_dir/venv/bin/python" \
  -c 'from integration_api import create_app; assert callable(create_app)'

# systemd-analyze에서 서비스의 실제 경로를 검사한 후 활성화 없이 등록한다.
unit_files=()
for unit in "${units[@]}"; do
  unit_files+=("$source_dir/$unit")
done
systemd-analyze verify "${unit_files[@]}"
for unit in "${units[@]}"; do
  install -m 0644 "$source_dir/$unit" "$unit_dir/$unit"
done
systemctl daemon-reload

for unit in "${units[@]}"; do
  [[ "$(systemctl show -p LoadState --value "$unit")" == loaded ]]
  [[ "$(systemctl show -p ActiveState --value "$unit")" == inactive ]]
done
[[ "$(systemctl show -p UnitFileState --value landit-rds-integration.service)" == disabled ]]
[[ "$(systemctl show -p UnitFileState --value landit-alerts.timer)" == disabled ]]
printf '%s\n' "$revision" > "$runtime_dir/installed-revision"
printf 'inactive_revision=%s\n' "$revision"
