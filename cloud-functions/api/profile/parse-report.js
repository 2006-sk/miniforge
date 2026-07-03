/**
 * POST /api/profile/parse-report
 * Multipart "report" image (or JSON { imageBase64, mime }) of a medical report /
 * allergy list / discharge summary. LLM extracts allergies, conditions, medications.
 */

import { llmJson } from '../../_lib/llm.js';
import { jsonResponse, corsPreflight } from '../../_lib/sse.js';
import { env } from '../../_lib/env.js';

async function readReportImage(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('report') || form.get('image') || form.get('file');
    if (!file || typeof file === 'string') {
      throw new Error('report image file is required');
    }
    const buf = Buffer.from(await file.arrayBuffer());
    return {
      imageBase64: buf.toString('base64'),
      mime: file.type || 'image/jpeg',
    };
  }

  const body = await request.json();
  if (!body?.imageBase64) throw new Error('imageBase64 required');
  return {
    imageBase64: body.imageBase64,
    mime: body.mime || 'image/jpeg',
  };
}

export async function onRequestOptions() {
  return corsPreflight();
}

export async function onRequestPost(context) {
  let image;
  try {
    image = await readReportImage(context.request);
  } catch (err) {
    return jsonResponse({ error: err?.message || 'bad request' }, 400);
  }

  const visionModel = env('VISION_MODEL', 'Qwen/Qwen2.5-VL-72B-Instruct');

  try {
    const result = await llmJson({
      model: visionModel,
      vision: true,
      messages: [
        {
          role: 'system',
          content:
            'You extract structured medical profile fields from a photo of a medical report, allergy card, discharge summary, or clinic note. Only include items clearly supported by the document. Normalize names to short plain terms (e.g. "peanuts", "diabetes", "lisinopril"). Output JSON only.',
        },
        {
          role: 'user',
          content: [
            { type: 'image', mime: image.mime, data: image.imageBase64 },
            {
              type: 'text',
              text: 'Extract allergies, medical conditions, and medications. Return JSON: {"allergies":string[],"conditions":string[],"medications":string[],"notes":string}',
            },
          ],
        },
      ],
    });

    const data = result.data || {};
    return jsonResponse({
      allergies: Array.isArray(data.allergies) ? data.allergies.map(String) : [],
      conditions: Array.isArray(data.conditions) ? data.conditions.map(String) : [],
      medications: Array.isArray(data.medications) ? data.medications.map(String) : [],
      notes: data.notes ? String(data.notes) : '',
      via: result.via,
    });
  } catch (err) {
    return jsonResponse(
      { error: err?.message || 'Failed to parse medical report' },
      500,
    );
  }
}

export async function onRequest(context) {
  const method = context.request.method.toUpperCase();
  if (method === 'OPTIONS') return onRequestOptions();
  if (method === 'POST') return onRequestPost(context);
  return jsonResponse({ error: 'method not allowed' }, 405);
}
