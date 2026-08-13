// 디스코드 버튼·모달 상호작용 수신 엔드포인트 (Vercel 서버리스 함수)
import { createPublicKey, verify } from 'node:crypto';

import { fetchAscReplyText, sendAscReply } from '../src/asc.mjs';
import {
  applyReplyToEmbed,
  buildReplyButton,
  buildReplyModal,
  decodeCustomId,
} from '../src/interaction-lib.mjs';
import { fetchPlayReplyText, sendPlayReply } from '../src/play.mjs';

export const config = { api: { bodyParser: false } };

const ascCredentials = {
  issuerId: process.env.ASC_ISSUER_ID,
  keyId: process.env.ASC_KEY_ID,
  privateKey: process.env.ASC_PRIVATE_KEY,
};

// 디스코드 서명 검증 — raw ed25519 공개키를 SPKI로 감싸 Node crypto로 확인한다
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const isValidSignature = (rawBody, signature, timestamp) => {
  try {
    const key = createPublicKey({
      key: Buffer.concat([
        SPKI_PREFIX,
        Buffer.from(process.env.DISCORD_PUBLIC_KEY, 'hex'),
      ]),
      format: 'der',
      type: 'spki',
    });
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      key,
      Buffer.from(signature, 'hex'),
    );
  } catch {
    return false;
  }
};

const readRawBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const fetchExistingReply = (store, reviewId) =>
  store === 'appStore'
    ? fetchAscReplyText(ascCredentials, reviewId)
    : fetchPlayReplyText(process.env.PLAY_SERVICE_ACCOUNT_JSON, reviewId);

const sendReply = (store, reviewId, text) =>
  store === 'appStore'
    ? sendAscReply(ascCredentials, reviewId, text)
    : sendPlayReply(process.env.PLAY_SERVICE_ACCOUNT_JSON, reviewId, text);

// 실패해도 팀원에게만 보이는 짧은 안내로 답한다 (flags 64 = 본인만 보기)
const ephemeral = (content) => ({ type: 4, data: { content, flags: 64 } });

// 서명된 요청을 통째로 재사용하는 재전송 공격을 막는다
const MAX_TIMESTAMP_AGE_SECONDS = 300;

export default async (req, res) => {
  const rawBody = await readRawBody(req);
  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  if (
    !signature ||
    !timestamp ||
    !isValidSignature(rawBody, signature, timestamp)
  ) {
    return res.status(401).json({ error: 'invalid signature' });
  }
  if (
    Math.abs(Date.now() / 1000 - Number(timestamp)) > MAX_TIMESTAMP_AGE_SECONDS
  ) {
    return res.status(401).json({ error: 'stale timestamp' });
  }

  const interaction = JSON.parse(rawBody.toString());

  // PING — 디스코드가 엔드포인트 등록 시 보내는 생존 확인
  if (interaction.type === 1) return res.status(200).json({ type: 1 });

  // 버튼 클릭 — 답글 작성 모달을 연다 (수정이면 기존 답글 프리필)
  if (interaction.type === 3) {
    const { action, store, reviewId } = decodeCustomId(
      interaction.data.custom_id,
    );
    const existing =
      action === 'edit'
        ? await fetchExistingReply(store, reviewId).catch(() => null)
        : null;
    return res.status(200).json({
      type: 9,
      data: buildReplyModal(store, reviewId, existing),
    });
  }

  // 모달 제출 — 스토어에 답글을 보내고, 성공하면 버튼을 ✏️ 수정으로 바꾼다
  if (interaction.type === 5) {
    const { store, reviewId } = decodeCustomId(interaction.data.custom_id);
    const text = interaction.data.components[0].components[0].value;
    try {
      await sendReply(store, reviewId, text);
    } catch (e) {
      console.error('답글 전송 실패:', e.message);
      // 쓰는 사람이 개발자뿐이라 원인을 그대로 보여준다
      return res
        .status(200)
        .json(ephemeral(`답글 전송 실패 — ${e.message.slice(0, 300)}`));
    }
    // 성공 — 알림 카드에 답글 내용·작성자를 남기고 버튼을 ✏️ 수정으로 바꾼다
    // 서버 별명 → 전역 표시 이름 → 계정명 순으로 표기한다
    const author =
      interaction.member?.nick ??
      interaction.member?.user?.global_name ??
      interaction.member?.user?.username ??
      '알 수 없음';
    const embed = interaction.message?.embeds?.[0];
    return res.status(200).json({
      type: 7,
      data: {
        ...(embed && { embeds: [applyReplyToEmbed(embed, text, author)] }),
        components: [buildReplyButton(store, reviewId, true)],
      },
    });
  }

  return res.status(200).json(ephemeral('알 수 없는 상호작용이에요.'));
};
