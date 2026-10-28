import type { CachedModel } from '../registry/types.js';

export const CHEAPER_INFERENCE_PROVIDER_ID = 'cheaper-inference';
export const CHEAPER_INFERENCE_PROVIDER_NAME = 'Cheaper Inference';
export const CHEAPER_INFERENCE_COMPLETIONS_BASE_URL = 'https://api.cheaperinference.com/v1';

type CheaperInferenceModel = Pick<CachedModel, 'id' | 'name'>
  & Partial<Omit<CachedModel, 'id' | 'name'>>;

const OPENAI_COMPATIBLE = '@ai-sdk/openai-compatible';

// Context windows: `context_length` from the public catalog at
// https://api.cheaperinference.com/public/models (checked 2026-10-28).
// Modalities: that catalog's `supports_vision` (true for kimi-k3 and gpt-5.4-mini,
// false for glm-5.3 and deepseek-v4-flash). Image input through clodex is untested.
const CATALOG: CheaperInferenceModel[] = ([
  {
    id: 'kimi-k3',
    name: 'Kimi K3',
    contextWindow: 1000000,
    family: 'kimi',
    modalities: ['text', 'image'],
  },
  { id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1000000, family: 'glm', modalities: ['text'] },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    contextWindow: 1000000,
    family: 'deepseek',
    modalities: ['text'],
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    contextWindow: 400000,
    family: 'gpt',
    modalities: ['text', 'image'],
  },
] satisfies CheaperInferenceModel[]).map(model => ({
  ...model,
  upstreamModelId: model.id,
  modelFormat: 'openai' as const,
  npm: OPENAI_COMPATIBLE,
  apiUrl: CHEAPER_INFERENCE_COMPLETIONS_BASE_URL,
  // No per-token cost is recorded for this provider, and the template's
  // preserveModelPricing keeps the global pricing cache off it.
  compatibility: {
    supportsStore: false,
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens' as const,
    // Effort mapping is unverified against this gateway; send none.
    supportsReasoningEffort: false,
  },
}));

/**
 * Curated Cheaper Inference models supported by Clodex (Chat Completions only,
 * served at https://api.cheaperinference.com/v1). Live `/v1/models` is
 * availability data; this catalog is the allowlist and supplies per-model metadata.
 */
export function buildCheaperInferenceModels(): CheaperInferenceModel[] {
  return structuredClone(CATALOG);
}
