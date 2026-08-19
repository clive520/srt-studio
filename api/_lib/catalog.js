// 模型目錄（2026-08 驗證過仍現役、可用）
// role: stt（語音辨識／字幕檔，需逐字時間戳）、seg（句子分段，需 JSON 輸出能力）

export const CATALOG = {
  stt: [
    {
      id: 'groq',
      name: 'Groq',
      kind: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyUrl: 'https://console.groq.com/keys',
      free: true,
      models: [
        { id: 'whisper-large-v3-turbo', name: 'Whisper large-v3-turbo', note: '免費・超快・支援逐字時間戳（驗證可用）' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      keyUrl: 'https://platform.openai.com/api-keys',
      free: false,
      models: [
        { id: 'whisper-1', name: 'Whisper-1', note: '每分鐘約 $0.006・支援逐字時間戳' },
      ],
    },
    {
      id: 'assemblyai',
      name: 'AssemblyAI',
      kind: 'assemblyai',
      baseUrl: 'https://api.assemblyai.com',
      keyUrl: 'https://www.assemblyai.com/app/account/api-keys',
      free: false,
      models: [
        { id: 'universal', name: 'Universal（官方字幕）', note: '有免費額度・直接輸出 SRT' },
      ],
    },
  ],
  seg: [
    {
      id: 'opencode-go',
      name: 'OpenCode GO',
      kind: 'openai',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      keyUrl: 'https://opencode.ai/auth',
      free: false,
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '預設・GO 方案內最便宜（$0.07/$0.14 每百萬字）' },
      ],
    },
    {
      id: 'deepseek',
      name: 'DeepSeek 官方',
      kind: 'openai',
      baseUrl: 'https://api.deepseek.com/v1',
      keyUrl: 'https://platform.deepseek.com/api_keys',
      free: false,
      models: [
        { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '官方 API・$0.28/$0.42・JSON 輸出穩定' },
      ],
    },
    {
      id: 'gemini',
      name: 'Google Gemini',
      kind: 'openai',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      keyUrl: 'https://aistudio.google.com/apikey',
      free: false,
      models: [
        { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', note: '2026 現役（GA 5/19）・1M 上下文' },
        { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', note: '最便宜・快速' },
      ],
    },
    {
      id: 'groq',
      name: 'Groq',
      kind: 'openai',
      baseUrl: 'https://api.groq.com/openai/v1',
      keyUrl: 'https://console.groq.com/keys',
      free: true,
      models: [
        { id: 'groq/compound-mini', name: 'Compound Mini', note: '免費・70K TPM・本網站現役驗證可用' },
      ],
    },
    {
      id: 'openai',
      name: 'OpenAI',
      kind: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      keyUrl: 'https://platform.openai.com/api-keys',
      free: false,
      models: [
        { id: 'gpt-4o-mini', name: 'GPT-4o mini', note: '便宜・JSON 輸出穩定' },
      ],
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      kind: 'anthropic',
      baseUrl: 'https://api.anthropic.com',
      keyUrl: 'https://console.anthropic.com/settings/keys',
      free: false,
      models: [
        { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', note: '2026 現役・$3/$15・1M 上下文' },
      ],
    },
    {
      id: 'nvidia',
      name: 'NVIDIA（免費）',
      kind: 'openai',
      baseUrl: 'https://integrate.api.nvidia.com/v1',
      keyUrl: 'https://build.nvidia.com',
      free: true,
      models: [
        { id: 'nvidia/nemotron-3-super-120b-a12b', name: 'Nemotron 3 Super 120B', note: '免費 prototype・40 RPM' },
        { id: 'deepseek-ai/deepseek-v4-flash', name: 'DeepSeek V4 Flash', note: '免費 prototype・40 RPM（模型 ID 可能依帳號授權略有差異）' },
      ],
    },
  ],
};

export function findProvider(role, providerId) {
  return (CATALOG[role] || []).find((p) => p.id === providerId) || null;
}

export function findModel(role, providerId, modelId) {
  const p = findProvider(role, providerId);
  return p?.models?.find((m) => m.id === modelId) || null;
}

export function providerLabel(role, providerId, modelId) {
  const p = findProvider(role, providerId);
  const m = p?.models?.find((x) => x.id === modelId);
  if (!p || !m) return null;
  return { providerName: p.name, modelName: m.name, keyUrl: p.keyUrl };
}