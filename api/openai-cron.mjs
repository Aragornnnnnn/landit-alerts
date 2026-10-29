// 매일 Vercel에서 OpenAI 비용 보고의 GitHub 실행을 요청한다.
import { createCronHandler } from '../src/openai/trigger.mjs';
export default createCronHandler();
