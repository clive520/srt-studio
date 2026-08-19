// 句子分段核心邏輯（伺服器端）：分批送給 AI 決定段界，回傳 1-based 全域編號

const CHUNK_WORDS = 1000;

export function segPrompt(tokens) {
  const list = tokens.map((w, i) => `${i + 1}. ${w.word} [${w.start.toFixed(1)}-${w.end.toFixed(1)}]`).join('\n');
  return (
    '你是字幕分段專家。以下是語音辨識出的逐字稿，每個字詞附上編號與時間（秒）。' +
    '請把字詞分成適合字幕顯示的段落：以句意為界（句號、問號、驚嘆號結尾優先），' +
    '長句可在逗號或停頓處切開，每段以 8~25 個字為宜，段落內的語意要連貫，不要合併不相干內容。\n\n' +
    `${list}\n\n` +
    '請只回傳 JSON（不要任何其他文字）：{"boundaries":[數字,...]}，' +
    '數字代表每一段「最後一個字詞的編號」（最後一段不需要列）。'
  );
}

export function parseBoundaries(raw) {
  const m = String(raw || '').match(/\{[\s\S]*\}/);
  if (!m) throw new Error('AI 回傳的格式無法解析');
  let obj;
  try {
    obj = JSON.parse(m[0]);
  } catch (e) {
    throw new Error(`AI 回傳的 JSON 無法解析：${e.message}`);
  }
  const b = obj?.boundaries;
  if (!Array.isArray(b)) throw new Error('AI 回傳缺少 boundaries 欄位');
  return b.filter((x) => Number.isFinite(+x)).map((x) => Math.round(+x));
}

async function callOpenAI(provider, prompt) {
  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${provider.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

async function callAnthropic(provider, prompt) {
  const res = await fetch(`${provider.baseUrl}/v1/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': provider.key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 2000,
      system: '只回傳 JSON，不要任何其他文字。',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
  });
  if (!res.ok) throw new Error(await apiError(res));
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

async function apiError(res) {
  let msg = `HTTP ${res.status}`;
  try {
    const e = await res.json();
    msg = e.error?.message || e.error || e.message || JSON.stringify(e);
  } catch {
    /* ignore */
  }
  return msg;
}

/**
 * 把逐字稿（含逐字時間）交給 AI 決定分段點，回傳每一段結束字詞的
 * 1-based 全域編號（最後一段不需要列）。Promise<number[]>。
 * provider: { kind: 'openai'|'anthropic', baseUrl, model, key }
 */
export async function segmentByAI(provider, { words }) {
  const tokens = (words || []).filter((w) => w.word && w.word.trim());
  if (tokens.length < 3) throw new Error('字詞數量不足（至少 3 個字），無法 AI 分段');

  const caller = provider.kind === 'anthropic' ? callAnthropic : callOpenAI;
  const boundaries = [];
  for (let i = 0; i < tokens.length; i += CHUNK_WORDS) {
    const part = tokens.slice(i, i + CHUNK_WORDS);
    const raw = await caller(provider, segPrompt(part));
    const seen = new Set(boundaries);
    for (const b of parseBoundaries(raw)) {
      const g = i + b; // 批次內是 1-based 編號，換算回全域
      if (g > 0 && g <= tokens.length && !seen.has(g)) {
        seen.add(g);
        boundaries.push(g);
      }
    }
  }
  if (!boundaries.length) throw new Error('AI 回傳的段界無法使用');
  return boundaries;
}