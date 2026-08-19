let OpenCC = null;

async function getOpenCC() {
  if (!OpenCC) {
    const m = await import('opencc-js');
    OpenCC = m && m.Converter ? m : m.default;
  }
  return OpenCC;
}

export const OUTPUT_LANGS = [
  { value: 'traditional', label: '繁體中文' },
  { value: 'simplified', label: '簡體中文' },
  { value: 'keep', label: '保持原樣' },
];

let toTw = null;
let toCn = null;

export async function convertText(text, mode) {
  if (!text || mode === 'keep') return text;
  const oc = await getOpenCC();
  if (mode === 'traditional') {
    toTw = toTw || oc.Converter({ from: 'cn', to: 'twp' });
    return toTw(text);
  }
  if (mode === 'simplified') {
    toCn = toCn || oc.Converter({ from: 'tw', to: 'cn' });
    return toCn(text);
  }
  return text;
}

export async function convertSegments(segs, mode) {
  if (!mode || mode === 'keep') return segs;
  const out = [];
  for (const s of segs) {
    out.push({ ...s, text: await convertText(s.text, mode) });
  }
  return out;
}