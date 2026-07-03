/**
 * Model routing:
 *   1. EdgeOne model gateway (OpenAI-compatible) when MAKERS_MODELS_KEY is set
 *   2. Nebius Token Factory (OpenAI-compatible) when gateway lacks the model / vision / fails
 *
 * Vision: no gateway built-in vision models → Nebius-first with VISION_MODEL
 * (default Qwen/Qwen2.5-VL-72B-Instruct).
 */

import OpenAI from 'openai';
import { env } from './env.js';

const GATEWAY_BASE = 'https://ai-gateway.edgeone.link/v1';
const NEBIUS_BASE = 'https://api.tokenfactory.nebius.com/v1';

/** Strong Nebius defaults when TEXT_MODEL/VISION_MODEL still point at Claude IDs. */
const NEBIUS_TEXT_DEFAULT = 'meta-llama/Llama-3.3-70B-Instruct';
const NEBIUS_VISION_DEFAULT = 'Qwen/Qwen2.5-VL-72B-Instruct';

function stripJsonFences(text) {
  if (!text) return text;
  let t = String(text).trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  return t.trim();
}

export function parseJsonLoose(text) {
  const cleaned = stripJsonFences(text);
  return JSON.parse(cleaned);
}

function toOpenAIMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id || m.id || 'tool',
        content:
          typeof m.content === 'string'
            ? m.content
            : JSON.stringify(m.content ?? {}),
      };
    }
    if (typeof m.content === 'string' || m.content == null) return m;
    if (!Array.isArray(m.content)) return m;
    const parts = m.content.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image') {
        return {
          type: 'image_url',
          image_url: {
            url: `data:${p.mime || p.media_type || 'image/jpeg'};base64,${p.data || p.base64}`,
          },
        };
      }
      return p;
    });
    return { ...m, content: parts };
  });
}

function toOpenAITools(tools) {
  if (!tools?.length) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.parameters || { type: 'object', properties: {} },
    },
  }));
}

/** Map Claude-style IDs to Nebius models; pass through real Nebius IDs. */
export function resolveNebiusModel(model, { vision = false } = {}) {
  const m = (model || '').trim();
  if (!m || /claude/i.test(m)) {
    return vision
      ? NEBIUS_VISION_DEFAULT
      : env('NEBIUS_TEXT_MODEL', NEBIUS_TEXT_DEFAULT);
  }
  return m;
}

async function callOpenAICompatible({ baseURL, apiKey, model, messages, tools, via }) {
  const client = new OpenAI({ apiKey, baseURL });
  const body = {
    model,
    messages: toOpenAIMessages(messages),
    temperature: 0.2,
  };
  const oaiTools = toOpenAITools(tools);
  if (oaiTools) {
    body.tools = oaiTools;
    body.tool_choice = 'auto';
  }

  const completion = await client.chat.completions.create(body);
  const choice = completion.choices?.[0]?.message;
  if (!choice) throw new Error(`Empty ${via} response`);

  const toolCalls = (choice.tool_calls || []).map((tc) => ({
    id: tc.id,
    name: tc.function?.name,
    arguments: (() => {
      try {
        return JSON.parse(tc.function?.arguments || '{}');
      } catch {
        return {};
      }
    })(),
  }));

  return {
    text: choice.content || '',
    toolCalls,
    via,
  };
}

async function callGateway({ model, messages, tools }) {
  const key = env('MAKERS_MODELS_KEY');
  if (!key) throw new Error('MAKERS_MODELS_KEY not set');
  return callOpenAICompatible({
    baseURL: GATEWAY_BASE,
    apiKey: key,
    model,
    messages,
    tools,
    via: 'edgeone-gateway',
  });
}

async function callNebius({ model, messages, tools, vision = false }) {
  const key = env('NEBIUS_API_KEY');
  if (!key) throw new Error('NEBIUS_API_KEY not set');
  const nebiusModel = resolveNebiusModel(model, { vision });
  console.log(`[llm] nebius model id=${nebiusModel}`);
  return callOpenAICompatible({
    baseURL: NEBIUS_BASE,
    apiKey: key,
    model: nebiusModel,
    messages,
    tools,
    via: 'nebius',
  });
}

/**
 * Prefer gateway for text when keyed; Nebius-first for vision.
 * Fallback path is always Nebius (NEBIUS_API_KEY).
 */
export async function llmCall({ model, messages, tools, vision = false }) {
  const keyGateway = env('MAKERS_MODELS_KEY');
  const keyNebius = env('NEBIUS_API_KEY');

  const preferNebiusFirst = vision || !keyGateway;

  const attempts = preferNebiusFirst
    ? [
        { name: 'nebius', fn: () => callNebius({ model, messages, tools, vision }) },
        { name: 'edgeone-gateway', fn: () => callGateway({ model, messages, tools }) },
      ]
    : [
        { name: 'edgeone-gateway', fn: () => callGateway({ model, messages, tools }) },
        { name: 'nebius', fn: () => callNebius({ model, messages, tools, vision }) },
      ];

  const errors = [];
  for (const attempt of attempts) {
    if (attempt.name === 'edgeone-gateway' && !keyGateway) continue;
    if (attempt.name === 'nebius' && !keyNebius) continue;
    try {
      const result = await attempt.fn();
      console.log(
        `[llm] path=${result.via} model=${model} vision=${!!vision}`,
      );
      return result;
    } catch (err) {
      console.warn(`[llm] ${attempt.name} failed:`, err?.message || err);
      errors.push(`${attempt.name}: ${err?.message || err}`);
    }
  }

  throw new Error(`llmCall failed — ${errors.join(' | ') || 'no API keys configured'}`);
}

/**
 * JSON-only LLM call with one retry on parse failure.
 */
export async function llmJson({ model, messages, tools, vision = false }) {
  const jsonHint = {
    role: 'user',
    content: 'Respond with a single JSON object only. No markdown, no prose.',
  };

  let msgs = [...messages, jsonHint];
  let lastVia = 'nebius';

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await llmCall({ model, messages: msgs, tools, vision });
    lastVia = result.via;
    if (result.toolCalls?.length) {
      return { data: null, toolCalls: result.toolCalls, text: result.text, via: result.via };
    }
    try {
      const data = parseJsonLoose(result.text);
      return { data, toolCalls: [], text: result.text, via: result.via };
    } catch {
      if (attempt === 0) {
        msgs = [
          ...messages,
          { role: 'assistant', content: result.text || '' },
          {
            role: 'user',
            content:
              'Your previous output was invalid JSON. Output only the JSON object.',
          },
        ];
        continue;
      }
      const err = new Error('Invalid JSON from model after retry');
      err.via = lastVia;
      throw err;
    }
  }
}

/** List Nebius models (for setup / smoke). */
export async function listNebiusModels() {
  const key = env('NEBIUS_API_KEY');
  if (!key) throw new Error('NEBIUS_API_KEY not set');
  const client = new OpenAI({ apiKey: key, baseURL: NEBIUS_BASE });
  const list = await client.models.list();
  return list.data.map((m) => m.id);
}
