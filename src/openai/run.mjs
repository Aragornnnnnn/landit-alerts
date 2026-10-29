// 전날 키별 비용을 로컬에서 미리 보거나 날짜별 중복 방지 후 디스코드에 전송한다.
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectReport, postReport, previousDate, parseKeyNames } from './report.mjs';
import { ReportError } from './costs.mjs';

export const runReport = async ({ send = false, env = process.env, now = new Date(), fetchImpl = fetch }) => {
  const root = resolve(env.OPENAI_STATE_DIR ?? '.state/openai');
  const date = previousDate(now);
  const stateFile = resolve(root, `${date}.json`);
  let lock;
  try {
    if (send) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      try { lock = await open(resolve(root, 'send.lock'), 'wx', 0o600); }
      catch { throw new ReportError('다른 전송이 실행 중이거나 이전 실행이 중단되었습니다. 상태 확인 필요.'); }
      let state;
      try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw new ReportError('기존 전송 상태 파일을 읽을 수 없습니다'); }
      if (state) {
        if (state.status === 'sent') return { status: 'already-sent', date };
        throw new ReportError('이전 전송 결과가 불확실합니다. Discord를 확인하기 전에는 재전송하지 않습니다.');
      }
    }
    const report = await collectReport({ organizationId: env.OPENAI_ORG_ID, adminKey: env.OPENAI_ADMIN_KEY, openRouterManagementKey: env.OPENROUTER_MANAGEMENT_KEY, keyNames: parseKeyNames(env.OPENAI_KEY_NAMES), now, fetchImpl });
    if (!send) return { status: 'preview', report };
    if (!env.DISCORD_WEBHOOK_OPENAI) throw new ReportError('DISCORD_WEBHOOK_OPENAI 미설정');
    await writeFile(stateFile, JSON.stringify({ status: 'pending', date, startedAt: now.toISOString() }), { flag: 'wx', mode: 0o600 });
    const messageId = await postReport({ webhookUrl: env.DISCORD_WEBHOOK_OPENAI, report, fetchImpl });
    const temp = `${stateFile}.tmp`;
    await writeFile(temp, JSON.stringify({ status: 'sent', date, messageId, complete: report.complete }), { mode: 0o600 });
    await rename(temp, stateFile);
    return { status: 'sent', date, messageId, complete: report.complete };
  } finally {
    if (lock) {
      await lock.close();
      await unlink(resolve(root, 'send.lock'));
    }
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args[0] && args[0] !== '--send'))
      throw new ReportError('사용: node --env-file=.env.openai src/openai/run.mjs [--send]');
    const result = await runReport({ send: args[0] === '--send' });
    if (result.status === 'preview') {
      console.log(result.report.content);
    } else if (result.status === 'already-sent') console.log(`${result.date}: 이미 전송했습니다.`);
    else console.log(`${result.date}: ${result.complete ? '전체 보고' : '일부 조회 실패를 포함한 보고'} 전송 완료. message_id=${result.messageId}`);
  } catch (error) {
    console.error(error instanceof ReportError ? error.message : 'OpenAI 보고 실행 실패. 비밀값을 제외한 설정·입력 파일·네트워크 상태를 확인하세요.');
    process.exitCode = 1;
  }
}
