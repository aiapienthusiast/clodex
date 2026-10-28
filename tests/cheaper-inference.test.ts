import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCheaperInferenceModels,
  CHEAPER_INFERENCE_COMPLETIONS_BASE_URL,
} from '../src/data/cheaper-inference-models.js';
import { buildHttpProxyRoutes } from '../src/http-proxy/routes.js';
import { transformOpenAiCompatibleRequestBody } from '../src/model-runtime-compatibility.js';
import { effortProviderOptions } from '../src/provider-factory.js';
import { getTemplateById, listAddableTemplates } from '../src/provider-templates.js';
import { applyTemplateModelMetadata, fetchTemplateModels } from '../src/registry/fetch-template-models.js';
import { materializeRegistry } from '../src/registry/materialize.js';
import { providerPreservesModelPricing } from '../src/registry/pricing.js';
import type { CachedModel, ProviderRegistry } from '../src/registry/types.js';

const IDS = ['kimi-k3', 'glm-5.3', 'deepseek-v4-flash', 'gpt-5.4-mini'];

function liveModel(id: string): CachedModel {
  return {
    id,
    name: `live ${id}`,
    upstreamModelId: id,
    family: id.split('-')[0] ?? id,
    brand: 'Cheaper Inference',
    modelFormat: 'openai',
    npm: '@ai-sdk/openai-compatible',
  };
}

function cheaperInferenceRegistry(models: CachedModel[]): ProviderRegistry {
  return {
    schemaVersion: 1,
    providers: [{
      id: 'cheaper-inference',
      templateId: 'cheaper-inference',
      name: 'Cheaper Inference',
      enabled: true,
      authRef: 'keyring:provider:cheaper-inference',
      authType: 'api',
      preserveModelPricing: true,
      api: { npm: '@ai-sdk/openai-compatible', url: CHEAPER_INFERENCE_COMPLETIONS_BASE_URL },
      modelsCache: { fetchedAt: '2026-10-28T00:00:00.000Z', models },
      addedAt: '2026-10-28T00:00:00.000Z',
    }],
  };
}

describe('Cheaper Inference template and catalog', () => {
  it('is a builtin addable api template pinned to api.cheaperinference.com/v1', () => {
    const template = getTemplateById('cheaper-inference')!;
    expect(template).toMatchObject({
      name: 'Cheaper Inference',
      authType: 'api',
      npm: '@ai-sdk/openai-compatible',
      defaultBaseUrl: 'https://api.cheaperinference.com/v1',
      modelsPath: '/models',
      signupUrl: 'https://cheaperinference.com',
      staticModelPolicy: 'allowlist',
      preserveModelPricing: true,
      supported: true,
    });
    // /models needs the key, so the shared models fetch is the credential check.
    expect(template.verifyCredential).toBeUndefined();
    expect(listAddableTemplates([]).map(t => t.id)).toContain('cheaper-inference');
    expect(listAddableTemplates(['cheaper-inference']).map(t => t.id)).not.toContain('cheaper-inference');
  });

  it('catalog holds exactly the four Chat Completions models with sane invariants', () => {
    const models = buildCheaperInferenceModels();
    expect(models.map(m => m.id)).toEqual(IDS);
    for (const model of models) {
      expect(model.modelFormat, model.id).toBe('openai');
      expect(model.npm, model.id).toBe('@ai-sdk/openai-compatible');
      expect(model.apiUrl, model.id).toBe('https://api.cheaperinference.com/v1');
      expect(model.upstreamModelId, model.id).toBe(model.id);
      expect(Number.isInteger(model.contextWindow), model.id).toBe(true);
      expect(model.contextWindow!, model.id).toBeGreaterThan(0);
      expect(model.contextWindow!, model.id).toBeLessThanOrEqual(10_000_000);
      expect(model.name.trim(), model.id).toBeTruthy();
      expect(model.cost, model.id).toBeUndefined();
    }
  });

  it('returns isolated catalog copies', () => {
    buildCheaperInferenceModels()[0]!.name = 'mutated';
    expect(buildCheaperInferenceModels()[0]!.name).toBe('Kimi K3');
  });

  it('allowlist hides unlisted live models and overlays curated metadata', () => {
    const template = getTemplateById('cheaper-inference')!;
    const result = applyTemplateModelMetadata(template, [
      liveModel('text-embedding-3-small'),
      liveModel('kimi-k3'),
      liveModel('gpt-5.4'),
      liveModel('deepseek-v4-flash'),
    ]);
    expect(result.map(m => m.id)).toEqual(['kimi-k3', 'deepseek-v4-flash']);
    expect(result[0]).toMatchObject({
      name: 'Kimi K3',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      apiUrl: CHEAPER_INFERENCE_COMPLETIONS_BASE_URL,
    });
  });

  it('materializes a Chat Completions route with the stored key', () => {
    const template = getTemplateById('cheaper-inference')!;
    const models = applyTemplateModelMetadata(template, IDS.map(liveModel));
    const providers = materializeRegistry(cheaperInferenceRegistry(models), () => 'ci-key');
    const routes = buildHttpProxyRoutes(providers, [
      { providerId: 'cheaper-inference', modelId: 'glm-5.3' },
    ]).routes;
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({
      providerId: 'cheaper-inference',
      modelFormat: 'openai',
      npm: '@ai-sdk/openai-compatible',
      baseURL: CHEAPER_INFERENCE_COMPLETIONS_BASE_URL,
      apiKey: 'ci-key',
    });
  });
});

describe('Cheaper Inference model discovery with the real template', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lists models from api.cheaperinference.com/v1/models and keeps only the allowlist', async () => {
    // Answers with an OpenAI `{data: [...]}` list at the real path only.
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => (
      url === 'https://api.cheaperinference.com/v1/models'
        && (init?.headers as Record<string, string> | undefined)?.Authorization === 'Bearer ci-key'
        ? new Response(JSON.stringify({
          object: 'list',
          data: [
            { id: 'text-embedding-3-small', object: 'model' },
            { id: 'glm-5.3', object: 'model' },
            { id: 'gpt-5.4-mini', object: 'model' },
          ],
        }), { status: 200 })
        : new Response('{"error":"not found"}', { status: 404 })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await fetchTemplateModels(getTemplateById('cheaper-inference')!, 'ci-key');
    expect(result.error).toBeUndefined();
    expect(fetchMock.mock.calls.map(call => call[0])).toEqual(['https://api.cheaperinference.com/v1/models']);
    expect(result.models.map(m => [m.id, m.name])).toEqual([
      ['glm-5.3', 'GLM-5.3'],
      ['gpt-5.4-mini', 'GPT-5.4 Mini'],
    ]);
  });

  it('reports a rejected key from the 401 the models endpoint returns', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response('{"error":{"message":"invalid api key"}}', { status: 401 })));
    const result = await fetchTemplateModels(getTemplateById('cheaper-inference')!, 'bad-key');
    expect(result.models).toEqual([]);
    expect(result.error).toBe('API key was rejected.');
    expect(result.hint).toContain('https://cheaperinference.com');
  });
});

describe('Cheaper Inference per-model metadata', () => {
  // contextWindow is `context_length` and modalities follow `supports_vision` from
  // https://api.cheaperinference.com/public/models (checked 2026-10-28). Re-check
  // before changing them.
  const EXPECTED: Record<string, {
    name: string;
    family: string;
    contextWindow: number;
    modalities: string[];
  }> = {
    'kimi-k3': { name: 'Kimi K3', family: 'kimi', contextWindow: 1000000, modalities: ['text', 'image'] },
    'glm-5.3': { name: 'GLM-5.3', family: 'glm', contextWindow: 1000000, modalities: ['text'] },
    'deepseek-v4-flash': {
      name: 'DeepSeek V4 Flash',
      family: 'deepseek',
      contextWindow: 1000000,
      modalities: ['text'],
    },
    'gpt-5.4-mini': { name: 'GPT-5.4 Mini', family: 'gpt', contextWindow: 400000, modalities: ['text', 'image'] },
  };

  it('pins every curated field for each model', () => {
    const models = buildCheaperInferenceModels();
    expect(models.map(m => m.id)).toEqual(Object.keys(EXPECTED));
    for (const model of models) {
      expect(model, model.id).toEqual({
        id: model.id,
        ...EXPECTED[model.id],
        upstreamModelId: model.id,
        modelFormat: 'openai',
        npm: '@ai-sdk/openai-compatible',
        apiUrl: 'https://api.cheaperinference.com/v1',
        compatibility: {
          supportsStore: false,
          supportsDeveloperRole: false,
          maxTokensField: 'max_tokens',
          supportsReasoningEffort: false,
        },
      });
    }
  });

  it('carries the curated window and wire quirks from discovery through materialization', () => {
    const template = getTemplateById('cheaper-inference')!;
    // Live discovery carries no window or compatibility; the overlay supplies them.
    const discovered = applyTemplateModelMetadata(template, IDS.map(liveModel));
    const [provider] = materializeRegistry(cheaperInferenceRegistry(discovered), () => 'ci-key');
    expect(provider!.models.map(m => m.id)).toEqual(IDS);
    for (const model of provider!.models) {
      expect(model.contextWindow, model.id).toBe(EXPECTED[model.id]!.contextWindow);
      expect(model.modalities, model.id).toEqual(EXPECTED[model.id]!.modalities);

      const body = transformOpenAiCompatibleRequestBody({
        model: model.id,
        store: true,
        max_completion_tokens: 4096,
        messages: [{ role: 'developer', content: 'rules' }, { role: 'user', content: 'hi' }],
      }, model.compatibility!) as Record<string, unknown>;
      expect(body, model.id).toEqual({
        model: model.id,
        max_tokens: 4096,
        messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hi' }],
      });

      const effort = effortProviderOptions(model.npm!, 'high', model.id, {
        providerId: 'cheaper-inference',
        compatibility: model.compatibility,
      } as never);
      expect(effort, model.id).toBeUndefined();
    }
  });

  it('launches on api.cheaperinference.com even when the stored provider URL differs', () => {
    const template = getTemplateById('cheaper-inference')!;
    const registry = cheaperInferenceRegistry(applyTemplateModelMetadata(template, IDS.map(liveModel)));
    registry.providers[0]!.api.url = 'https://relay.example/v1';
    const [provider] = materializeRegistry(registry, () => 'ci-key');
    for (const model of provider!.models) {
      expect(model.completionsUrl, model.id).toBe('https://api.cheaperinference.com/v1/chat/completions');
    }
  });

  it('keeps the shared pricing cache off a record whose persisted flag is absent', () => {
    expect(providerPreservesModelPricing({ templateId: 'cheaper-inference' })).toBe(true);
    // An explicit persisted choice still wins.
    expect(providerPreservesModelPricing({ templateId: 'cheaper-inference', preserveModelPricing: false }))
      .toBe(false);
  });
});
