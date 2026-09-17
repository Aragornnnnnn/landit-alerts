// 서드파티 상태 알림 실행부 — 상태 파일과 비교해 레벨이 바뀐 서비스만 디스코드로 보낸다
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { sendEmbed } from './discord.mjs';
import {
  TARGETS,
  buildStatusEmbed,
  diffStatusChanges,
  fetchTargetStatus,
  nextLevels,
} from './status.mjs';

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

const state = await loadState();
const firstRun = !state.initialized;

const current = await Promise.all(TARGETS.map(fetchTargetStatus));
const changes = diffStatusChanges(state.levels ?? {}, current);

// 첫 실행은 기준점만 저장한다 (지금 장애 중인 서비스를 새 장애로 알리지 않기 위해서다)
if (!firstRun) {
  for (const change of changes) {
    const target = TARGETS.find((t) => t.key === change.key);
    await sendEmbed(WEBHOOK, buildStatusEmbed(target, change));
  }
}

state.levels = nextLevels(state.levels ?? {}, current);
state.initialized = true;

await mkdir(dirname(STATE_FILE), { recursive: true });
await writeFile(STATE_FILE, JSON.stringify(state, null, 2));

const unread = current.filter((entry) => entry.level === 'unknown');
console.log(
  firstRun
    ? '첫 실행 — 기준점만 저장했습니다.'
    : `완료 — 알림 ${changes.length}건 전송.`,
);
if (unread.length)
  console.error(
    `상태를 못 읽음: ${unread.map((e) => `${e.key}(${e.description})`).join(' / ')}`,
  );
