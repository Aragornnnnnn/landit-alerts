// 서드파티 상태 알림 실행부 — 상태 파일과 비교해 레벨이 바뀐 서비스만 디스코드로 보낸다
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { sendEmbed } from '../shared/discord.mjs';
import {
  TARGETS,
  buildStatusEmbed,
  diffStatusChanges,
  nextLevels,
} from './lib.mjs';
import { fetchTargetStatus } from './source.mjs';

const STATE_FILE = process.env.STATE_FILE ?? '.state/status-alerts.json';
const WEBHOOK = process.env.DISCORD_WEBHOOK_DEPS;

if (!WEBHOOK) {
  console.error('환경변수가 필요합니다: DISCORD_WEBHOOK_DEPS');
  process.exit(1);
}

const loadState = async () => {
  try {
    return JSON.parse(await readFile(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
};

const targetByKey = new Map(TARGETS.map((target) => [target.key, target]));

const state = await loadState();
const firstRun = !state.initialized;
const previousLevels = state.levels ?? {};

const current = await Promise.all(TARGETS.map(fetchTargetStatus));
const changes = diffStatusChanges(previousLevels, current);

// 첫 실행은 기준점만 저장한다 (지금 장애 중인 서비스를 새 장애로 알리지 않기 위해서다)
if (!firstRun) {
  for (const change of changes) {
    await sendEmbed(
      WEBHOOK,
      buildStatusEmbed(targetByKey.get(change.key), change),
    );
  }
}

state.levels = nextLevels(previousLevels, current);
state.initialized = true;

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));

console.log(
  firstRun
    ? '첫 실행 — 기준점만 저장했습니다.'
    : `완료 — 알림 ${changes.length}건 전송.`,
);

// 못 읽은 대상은 알림이 안 나가므로 로그가 유일한 흔적이다
const unread = current.filter((entry) => entry.level === 'unknown');
if (unread.length)
  console.error(
    `상태를 못 읽음: ${unread.map((entry) => `${entry.key}(${entry.response})`).join(' / ')}`,
  );
