# Cheaper Inference provider

Clodex can expose Cheaper Inference models alongside Claude and OpenAI/Codex models in the same Claude Code session. Cheaper Inference is an OpenAI-compatible LLM gateway.

## Setup

```bash
clodex providers add
```

Choose **Cheaper Inference API key** and paste a key from <https://cheaperinference.com>. Then use `clodex models` to add models to favorites and `clodex patch` to make them selectable in Claude Code.

Models are served through the OpenAI-compatible SDK at `https://api.cheaperinference.com/v1/chat/completions` (Bearer key). Every catalog model carries that address, so `providers add`, its key check, and launched sessions always use it. A model-list refresh (`clodex providers refresh-models`) instead uses the provider's stored `api.url` in `providers.json`, which `providers add` sets to the same address.

## Supported models

Chat Completions only, from a committed allowlist (`src/data/cheaper-inference-models.ts`): `kimi-k3`, `glm-5.3`, `deepseek-v4-flash`, `gpt-5.4-mini`. Live `/v1/models` results are availability data; models absent from the allowlist are hidden. Clodex does not record per-token rates for this provider: no per-token cost is set and the global pricing cache is not applied. See <https://cheaperinference.com/docs> for the current rates.

## Credential check

`https://api.cheaperinference.com/v1/models` answers HTTP 401 without a key (observed 2026-10-28), so the shared model-list check rejects a bad key before it is saved. No separate probe is sent.

## Known gaps

- Context windows come from `context_length` in the public catalog at `https://api.cheaperinference.com/public/models` (1,000,000 for `kimi-k3`, `glm-5.3` and `deepseek-v4-flash`, 400,000 for `gpt-5.4-mini`, checked 2026-10-28). The largest prompt the gateway actually accepts has not been measured.
- Reasoning-effort mapping is unverified, so no effort is sent (`supportsReasoningEffort: false`).
- Input modalities follow `supports_vision` in the same catalog: `kimi-k3` and `gpt-5.4-mini` are marked text and image, `glm-5.3` and `deepseek-v4-flash` text only. Image input through clodex is untested.
- Whether streamed responses carry a final usage chunk without `stream_options.include_usage` has not been measured, so no `stream_options` is sent.
