// 서버 예약에서 보고 준비·전송을 분리해 전송 전 중복 방지 상태를 영속화한다.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectReport, parseKeyNames, postReport, previousDate } from './report.mjs';
import { ReportError, utcDayRange } from './costs.mjs';

const paths = (env) => ({
  state: resolve(env.OPENAI_STATE_DIR ?? '.state/openai-server', 'delivery.json'),
  report: resolve(env.OPENAI_REPORT_FILE ?? '.state/openai-private-report.json'),
});
const identity = (env, now) => {
  const date = env.OPENAI_REPORT_DATE || previousDate(now);
  const runId = env.OPENAI_REPORT_RUN;
  if (!runId || !/^[\w:-]+$/.test(runId)) throw new ReportError('서버 실행 ID 미설정');
  const { end } = utcDayRange(date);
  if (end * 1000 > now.getTime()) throw new ReportError('완료되지 않은 보고 날짜');
  return { date, runId };
};

export const prepareDelivery = async ({ env = process.env, now = new Date(), fetchImpl = fetch } = {}) => {
  const { date, runId } = identity(env, now);
  const { state, report: reportPath } = paths(env);
  let existing;
  try { existing = JSON.parse(await readFile(state, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw new ReportError('전송 상태 파일 오류'); }
  if (existing) {
    if (existing.date !== date) throw new ReportError('복원한 캐시의 날짜가 다릅니다');
    if (existing.status === 'sent') return { ready: false, date };
    throw new ReportError('이전 전송 결과가 불확실합니다. Discord 확인 후 캐시 복구가 필요합니다');
  }
  if (!env.DISCORD_WEBHOOK_OPENAI) throw new ReportError('Discord 웹훅 미설정');
  const report = await collectReport({
    adminKey: env.OPENAI_ADMIN_KEY, organizationId: env.OPENAI_ORG_ID,
    keyNames: parseKeyNames(env.OPENAI_KEY_NAMES), date, now, fetchImpl,
  });
  await mkdir(dirname(reportPath), { recursive: true, mode: 0o700 });
  await mkdir(dirname(state), { recursive: true, mode: 0o700 });
  await writeFile(reportPath, JSON.stringify({ date, runId, report }), { mode: 0o600 });
  await writeFile(state, JSON.stringify({ date, runId, status: 'pending' }), { flag: 'wx', mode: 0o600 });
  return { ready: true, date };
};

export const deliverPrepared = async ({ env = process.env, now = new Date(), fetchImpl = fetch } = {}) => {
  const { date, runId } = identity(env, now);
  const { state: statePath, report: reportPath } = paths(env);
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const prepared = JSON.parse(await readFile(reportPath, 'utf8'));
  if (state.status !== 'pending' || state.date !== date || state.runId !== runId ||
      prepared.date !== date || prepared.runId !== runId || prepared.report.date !== date)
    throw new ReportError('보고 예약과 실행 정보가 일치하지 않습니다');
  const messageId = await postReport({ webhookUrl: env.DISCORD_WEBHOOK_OPENAI, report: prepared.report, fetchImpl });
  await writeFile(`${statePath}.tmp`, JSON.stringify({ date, status: 'sent', messageId, complete: prepared.report.complete }), { mode: 0o600 });
  await rename(`${statePath}.tmp`, statePath);
  return { date, messageId, complete: prepared.report.complete };
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'prepare') {
      const result = await prepareDelivery();
      if (process.env.GITHUB_OUTPUT) await writeFile(process.env.GITHUB_OUTPUT, `ready=${result.ready}\n`, { flag: 'a' });
      console.log(result.ready ? '보고 준비 완료. 전송 전 예약 상태를 저장하세요.' : '이미 전송한 날짜입니다.');
    } else if (process.argv[2] === 'send') {
      const result = await deliverPrepared();
      console.log(`Discord 전송 완료. 조회 상태: ${result.complete ? '성공' : '실패 안내'}.`);
    } else throw new ReportError('사용: node src/openai/server.mjs prepare|send');
  } catch (error) {
    console.error(error instanceof ReportError ? error.message : '서버 보고 실패. 설정·네트워크·전송 상태를 확인하세요.');
    process.exitCode = 1;
  }
}
