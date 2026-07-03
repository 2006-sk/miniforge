/**
 * MedScan agent — shared async generator used by both streaming paths.
 */

import { store } from './store.js';
import { llmCall, llmJson } from './llm.js';
import { env } from './env.js';

const EMPTY_PROFILE = {
  userId: null,
  allergies: [],
  conditions: [],
  medications: [],
};

const WEB_SEARCH_TOOL = {
  name: 'web_search',
  description:
    'search the web for real, currently available alternative products avoiding the flagged ingredients',
  parameters: {
    type: 'object',
    properties: {
      q: { type: 'string', description: 'Search query' },
    },
    required: ['q'],
  },
};

/** SerpApi (serpapi.com) — not serper.dev; same key shape, different host/API. */
async function webSearch(q) {
  const key = env('SERPAPI_API_KEY') || env('SERPER_API_KEY');
  if (!key) throw new Error('SERPAPI_API_KEY not set');

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const url = new URL('https://serpapi.com/search.json');
    url.searchParams.set('engine', 'google');
    url.searchParams.set('q', q);
    url.searchParams.set('num', '5');
    url.searchParams.set('api_key', key);

    const res = await fetch(url, { signal: ac.signal });
    if (!res.ok) throw new Error(`SerpApi HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    const organic = Array.isArray(data.organic_results) ? data.organic_results : [];
    return organic.map(({ title, link, snippet }) => ({ title, link, snippet }));
  } finally {
    clearTimeout(timer);
  }
}

function verdictFromRisk({ conflicts, riskScore, modelVerdict }) {
  const score = Number.isFinite(Number(riskScore)) ? Number(riskScore) : null;
  if (conflicts?.some((c) => c.severity === 'high') || (score != null && score >= 70)) {
    return 'AVOID';
  }
  if (conflicts?.length || (score != null && score > 0)) {
    return 'CAUTION';
  }
  const v = String(modelVerdict || '').toUpperCase();
  if (v === 'SAFE' || v === 'CAUTION' || v === 'AVOID') {
    // Never trust model AVOID/CAUTION with zero conflicts and zero score
    if ((v === 'AVOID' || v === 'CAUTION') && !conflicts?.length && (score == null || score === 0)) {
      return 'SAFE';
    }
    return v;
  }
  return 'SAFE';
}

function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(100, Math.round(x)));
}

/**
 * @param {{ userId: string, imageBase64: string, mime?: string, profile?: object|null }} input
 */
export async function* runScanAgent(input) {
  const { userId, imageBase64, mime = 'image/jpeg', profile: profileFromClient } = input;
  const textModel = env('TEXT_MODEL', 'claude-sonnet-4-6');
  const visionModel = env('VISION_MODEL', 'Qwen/Qwen2.5-VL-72B-Instruct');

  // ── profile.load ──────────────────────────────────────────────
  yield {
    step: 'profile.load',
    status: 'running',
    summary: 'Loading medical profile…',
    payload: {},
  };

  // Prefer profile sent with the scan (works across serverless instances).
  let profile = null;
  if (profileFromClient && typeof profileFromClient === 'object') {
    const meds = profileFromClient.medications;
    profile = {
      userId,
      allergies: Array.isArray(profileFromClient.allergies)
        ? profileFromClient.allergies.map(String)
        : [],
      conditions: Array.isArray(profileFromClient.conditions)
        ? profileFromClient.conditions.map(String)
        : [],
      medications: Array.isArray(meds)
        ? meds.map(String)
        : typeof meds === 'string'
          ? meds.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean)
          : [],
    };
    // Best-effort persist
    try {
      await store.set(`profile:${userId}`, profile);
    } catch {
      /* ignore */
    }
  } else {
    profile = await store.get(`profile:${userId}`);
  }

  let profileSummary = 'Profile loaded';
  if (!profile) {
    profile = { ...EMPTY_PROFILE, userId };
    profileSummary = 'No profile found — generic analysis';
  }

  yield {
    step: 'profile.load',
    status: 'done',
    summary: profileSummary,
    payload: profile,
  };

  // ── vision.extract_label ──────────────────────────────────────
  // Vision reads the photo. Ingredients may be missing (front-of-pack only).
  yield {
    step: 'vision.extract_label',
    status: 'running',
    summary: 'Reading product from photo…',
    payload: {},
  };

  let label;
  let visionVia = 'nebius';
  try {
    const visionResult = await llmJson({
      model: visionModel,
      vision: true,
      messages: [
        {
          role: 'system',
          content:
            'You identify products from photos. Always name the product/brand if visible. Transcribe ingredient text ONLY when it is actually readable on the image — do not invent ingredients. If the ingredient list is not visible (e.g. front packaging only), set ingredients to [] and readability to "poor". Output JSON only.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'image',
              mime,
              data: imageBase64,
            },
            {
              type: 'text',
              text: 'Identify this product. Transcribe ingredients only if visible on the image. Return JSON: {"product":string,"category":"food"|"cosmetic"|"medicine"|"other","ingredients":string[],"readability":"good"|"poor"}',
            },
          ],
        },
      ],
    });
    label = visionResult.data;
    visionVia = visionResult.via;
  } catch (err) {
    yield {
      step: 'vision.extract_label',
      status: 'error',
      summary: err?.message || 'Vision model failed',
      payload: { via: err?.via || visionVia },
    };
    return;
  }

  if (!label || !String(label.product || '').trim()) {
    yield {
      step: 'vision.extract_label',
      status: 'error',
      summary: 'Product not recognizable — retake showing the front or label',
      payload: { ...(label || {}), via: visionVia },
    };
    return;
  }

  label.ingredients = Array.isArray(label.ingredients) ? label.ingredients : [];
  const hasLabelIngredients = label.ingredients.length > 0 && label.readability !== 'poor';

  yield {
    step: 'vision.extract_label',
    status: 'done',
    summary: hasLabelIngredients
      ? `Read label: ${label.product}`
      : `Identified: ${label.product} (ingredients not visible on photo)`,
    payload: {
      ...label,
      ingredientsSource: hasLabelIngredients ? 'label' : 'none',
      via: visionVia,
    },
  };

  // ── ingredients.lookup (only when label ingredients missing) ───
  // Search the web for the product's ingredient list, then continue to risk.
  if (!hasLabelIngredients) {
    yield {
      step: 'ingredients.lookup',
      status: 'running',
      summary: `Looking up ingredients for ${label.product}…`,
      payload: {},
    };

    const lookupQuery = `${label.product} ingredients list`;
    let lookupResults = [];
    let lookupVia = 'serpapi';
    try {
      lookupResults = await webSearch(lookupQuery);
      if (!lookupResults.length) throw new Error('empty results');
    } catch (err) {
      console.warn('[agent] ingredients lookup search failed:', err?.message || err);
      lookupResults = [];
    }

    if (!lookupResults.length) {
      // Last resort: model knowledge of common product formulations
      try {
        const knowledge = await llmJson({
          model: textModel,
          messages: [
            {
              role: 'system',
              content:
                'You list typical ingredients for a known commercial product from general knowledge. Be conservative — only include ingredients you are reasonably confident about. Output JSON only.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                product: label.product,
                category: label.category,
                instruction:
                  'Return {"ingredients":string[],"confidence":"high"|"medium"|"low","source":"model"}',
              }),
            },
          ],
        });
        lookupVia = knowledge.via;
        const ing = knowledge.data?.ingredients;
        if (Array.isArray(ing) && ing.length) {
          label.ingredients = ing;
          label.ingredientsSource = 'model';
          label.readability = 'poor';
          yield {
            step: 'ingredients.lookup',
            status: 'done',
            summary: `Ingredients from model knowledge for ${label.product}`,
            payload: {
              query: lookupQuery,
              results: [],
              ingredients: label.ingredients,
              source: 'model',
              via: lookupVia,
            },
          };
        } else {
          yield {
            step: 'ingredients.lookup',
            status: 'error',
            summary:
              'Could not find ingredients — retake photo of the ingredient list',
            payload: { query: lookupQuery, results: [], via: 'serpapi' },
          };
          return;
        }
      } catch (err) {
        yield {
          step: 'ingredients.lookup',
          status: 'error',
          summary:
            'Could not find ingredients — retake photo of the ingredient list',
          payload: { query: lookupQuery, results: [], via: err?.via || lookupVia },
        };
        return;
      }
    } else {
      try {
        const extracted = await llmJson({
          model: textModel,
          messages: [
            {
              role: 'system',
              content:
                'Extract the product ingredient list from web search results. Prefer official or retailer ingredient lists. Do not invent ingredients not supported by the results. Output JSON only.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                product: label.product,
                category: label.category,
                searchQuery: lookupQuery,
                searchResults: lookupResults,
                instruction:
                  'Return {"ingredients":string[],"sourceUrl":string|null}',
              }),
            },
          ],
        });
        lookupVia = extracted.via;
        const ing = extracted.data?.ingredients;
        if (!Array.isArray(ing) || !ing.length) {
          yield {
            step: 'ingredients.lookup',
            status: 'error',
            summary:
              'Could not find ingredients — retake photo of the ingredient list',
            payload: {
              query: lookupQuery,
              results: lookupResults,
              via: 'serpapi',
            },
          };
          return;
        }
        label.ingredients = ing;
        label.ingredientsSource = 'web';
        label.ingredientsSourceUrl = extracted.data?.sourceUrl || lookupResults[0]?.link || null;
        label.readability = 'poor';

        yield {
          step: 'ingredients.lookup',
          status: 'done',
          summary: `Found ${ing.length} ingredient(s) online for ${label.product}`,
          payload: {
            query: lookupQuery,
            results: lookupResults,
            ingredients: label.ingredients,
            source: 'web',
            sourceUrl: label.ingredientsSourceUrl,
            via: 'serpapi',
            modelVia: lookupVia,
          },
        };
      } catch (err) {
        yield {
          step: 'ingredients.lookup',
          status: 'error',
          summary: err?.message || 'Ingredient lookup failed',
          payload: {
            query: lookupQuery,
            results: lookupResults,
            via: err?.via || lookupVia,
          },
        };
        return;
      }
    }
  }

  // ── risk.analyze (full profile context: allergies + conditions + meds) ─
  yield {
    step: 'risk.analyze',
    status: 'running',
    summary: 'Checking product against your allergies & conditions…',
    payload: {},
  };

  let conflicts = [];
  let reasons = [];
  let riskScore = 0;
  let modelVerdict = 'SAFE';
  let riskVia = 'nebius';
  try {
    const riskResult = await llmJson({
      model: textModel,
      messages: [
        {
          role: 'system',
          content: [
            'You are a cautious product-safety analyst for a specific patient profile.',
            'You MUST use the patient allergies, conditions, AND medications as context.',
            'ALLERGIES: any matching ingredient/derivative is severity high (e.g. peanuts, peanut butter, peanut oil; cheese/dairy; coffee/caffeine if listed).',
            'DIABETES / type 2 diabetes: flag sugar, granulated sugar, cane sugar, sucrose, glucose, fructose, HFCS, syrups, honey, candy, sweets, desserts, soda, and other high-glycemic products as severity high or medium. A product that IS sugar or is primarily sugar must NOT be SAFE.',
            'HYPERTENSION: flag salt, sodium, sodium chloride, soy sauce, and high-sodium products.',
            'KIDNEY DISEASE: flag high sodium and high potassium when evident.',
            'Every conflict MUST cite the exact profile item in conflictsWith (e.g. "allergies: peanuts" or "conditions: diabetes").',
            'reasons: 2-5 short plain-language bullets explaining the assessment for THIS patient (always include at least one reason).',
            'riskScore: integer 0-100 (0 = no concern for this profile, 100 = severe risk). Pure sugar for a diabetes patient should be riskScore >= 70.',
            'verdict: SAFE only if riskScore is 0 and conflicts is empty; CAUTION if mild/moderate concerns; AVOID if high-severity allergen or serious condition conflict (including sugar-heavy products for diabetes).',
            'No generic health advice. Informational only. Output JSON only.',
          ].join(' '),
        },
        {
          role: 'user',
          content: JSON.stringify({
            patientProfile: {
              allergies: profile.allergies || [],
              conditions: profile.conditions || [],
              medications: profile.medications || [],
            },
            product: label.product,
            category: label.category,
            ingredients: label.ingredients,
            ingredientsSource: label.ingredientsSource || 'label',
            instruction:
              'Return {"verdict":"SAFE"|"CAUTION"|"AVOID","riskScore":0-100,"reasons":string[],"conflicts":[{"ingredient":string,"conflictsWith":string,"severity":"high"|"medium"|"low","why":string}]}',
          }),
        },
      ],
    });
    conflicts = Array.isArray(riskResult.data?.conflicts) ? riskResult.data.conflicts : [];
    reasons = Array.isArray(riskResult.data?.reasons) ? riskResult.data.reasons.map(String) : [];
    riskScore = clampScore(riskResult.data?.riskScore);
    modelVerdict = riskResult.data?.verdict || 'SAFE';
    riskVia = riskResult.via;

    // Consistency: empty conflicts + score 0 ⇒ SAFE
    if (!conflicts.length && riskScore === 0) {
      modelVerdict = 'SAFE';
      if (!reasons.length) {
        reasons = [
          `No allergens or condition-related concerns found for ${label.product} given your profile.`,
        ];
      }
    }
    // High severity always elevates score
    if (conflicts.some((c) => c.severity === 'high') && riskScore < 70) riskScore = 70;
    if (conflicts.length && riskScore === 0) riskScore = 35;
  } catch (err) {
    yield {
      step: 'risk.analyze',
      status: 'error',
      summary: err?.message || 'Risk analysis failed',
      payload: { via: err?.via || riskVia },
    };
    return;
  }

  const preliminaryVerdict = verdictFromRisk({ conflicts, riskScore, modelVerdict });

  yield {
    step: 'risk.analyze',
    status: 'done',
    summary:
      conflicts.length === 0 && riskScore === 0
        ? `No concerns for your profile (risk ${riskScore}/100)`
        : `Risk ${riskScore}/100 — ${conflicts.length} conflict(s)`,
    payload: {
      conflicts,
      reasons,
      riskScore,
      verdict: preliminaryVerdict,
      profileUsed: {
        allergies: profile.allergies || [],
        conditions: profile.conditions || [],
        medications: profile.medications || [],
      },
      via: riskVia,
    },
  };

  // ── tool.web_search — always when risk > 0; find safer alternatives ─
  yield {
    step: 'tool.web_search',
    status: 'running',
    summary:
      riskScore > 0
        ? 'Searching for safer alternatives for your profile…'
        : 'Checking for profile-friendly options…',
    payload: {},
  };

  let searchPayload = { query: null, results: [], via: 'serpapi' };
  let searchSummary = 'No alternatives needed';
  let alternatives = [];
  let searchVia = riskVia;

  const flagged = conflicts.map((c) => c.ingredient).filter(Boolean);
  const needsAlternatives = riskScore > 0 || conflicts.length > 0;

  if (!needsAlternatives) {
    searchSummary = 'Product looks fine for your profile — no alternatives needed';
    searchPayload = { query: null, results: [], via: 'serpapi' };
  } else {
    const avoidBits = [
      ...flagged,
      ...(profile.allergies || []),
      ...(profile.conditions || []).map((c) => `${c}-friendly`),
    ].filter(Boolean);

    const baseMessages = [
      {
        role: 'system',
        content:
          'Find real, currently available alternative products that are safer for THIS patient profile (avoid their allergens and respect conditions like diabetes/hypertension). Use web_search. After tools, output JSON only: {"alternatives":[{"name":string,"reason":string,"source":string}]} where source is a URL or "model".',
      },
      {
        role: 'user',
        content: JSON.stringify({
          product: label.product,
          category: label.category,
          patientProfile: {
            allergies: profile.allergies || [],
            conditions: profile.conditions || [],
          },
          flaggedIngredients: flagged,
          conflicts,
          reasons,
          riskScore,
        }),
      },
    ];

    let toolIters = 0;
    let gotResults = false;
    let collectedResults = [];
    let lastQuery = null;

    while (toolIters < 2 && !gotResults) {
      let result;
      try {
        result = await llmCall({
          model: textModel,
          messages: baseMessages,
          tools: [WEB_SEARCH_TOOL],
        });
        searchVia = result.via;
      } catch (err) {
        console.warn('[agent] tool loop llm failed:', err?.message || err);
        break;
      }

      if (!result.toolCalls?.length) {
        try {
          const { parseJsonLoose } = await import('./llm.js');
          const data = parseJsonLoose(result.text);
          if (Array.isArray(data?.alternatives)) alternatives = data.alternatives;
        } catch {
          /* continue to knowledge fallback */
        }
        break;
      }

      for (const tc of result.toolCalls) {
        if (tc.name !== 'web_search') continue;
        toolIters += 1;
        const q =
          tc.arguments?.q ||
          tc.arguments?.query ||
          `safe alternatives to ${label.product} without ${avoidBits.slice(0, 4).join(' ')}`;
        lastQuery = q;
        try {
          const results = await webSearch(q);
          if (!results.length) throw new Error('empty results');
          collectedResults = results;
          gotResults = true;
          searchPayload = { query: q, results, via: 'serpapi' };
          searchSummary = `Found ${results.length} result(s) for "${q}"`;
        } catch (err) {
          console.warn('[agent] serpapi failed:', err?.message || err);
          searchPayload = { query: q || null, results: [], via: 'serpapi' };
          searchSummary = 'Search unavailable — using model knowledge';
        }
        if (toolIters >= 2 || gotResults) break;
      }
    }

    if (gotResults) {
      try {
        const final = await llmJson({
          model: textModel,
          messages: [
            {
              role: 'system',
              content:
                'Using search results, suggest safer alternatives for this patient profile. Each reason must mention why it is safer given their allergies/conditions. Output JSON only.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                product: label.product,
                patientProfile: {
                  allergies: profile.allergies || [],
                  conditions: profile.conditions || [],
                },
                flaggedIngredients: flagged,
                conflicts,
                searchQuery: lastQuery,
                searchResults: collectedResults,
                instruction:
                  'Return {"alternatives":[{"name":string,"reason":string,"source":string}]} — source is a result URL when possible.',
              }),
            },
          ],
        });
        searchVia = final.via;
        if (Array.isArray(final.data?.alternatives)) alternatives = final.data.alternatives;
      } catch (err) {
        console.warn('[agent] alternatives synthesis failed:', err?.message || err);
      }
    }

    if (!alternatives.length) {
      searchSummary =
        searchSummary.startsWith('Found')
          ? searchSummary
          : 'Search unavailable — using model knowledge';
      try {
        const knowledge = await llmJson({
          model: textModel,
          messages: [
            {
              role: 'system',
              content:
                'Suggest safer alternative products for this patient profile from your knowledge. source must be "model". Output JSON only.',
            },
            {
              role: 'user',
              content: JSON.stringify({
                product: label.product,
                category: label.category,
                patientProfile: {
                  allergies: profile.allergies || [],
                  conditions: profile.conditions || [],
                },
                flaggedIngredients: flagged,
                reasons,
                instruction:
                  'Return {"alternatives":[{"name":string,"reason":string,"source":"model"}]}',
              }),
            },
          ],
        });
        searchVia = knowledge.via;
        if (Array.isArray(knowledge.data?.alternatives)) {
          alternatives = knowledge.data.alternatives.map((a) => ({
            ...a,
            source: a.source || 'model',
          }));
        }
      } catch (err) {
        console.warn('[agent] model-knowledge alternatives failed:', err?.message || err);
      }
    }
  }

  yield {
    step: 'tool.web_search',
    status: 'done',
    summary: searchSummary,
    payload: { ...searchPayload, via: searchPayload.via || 'serpapi' },
  };

  // ── verdict.final ─────────────────────────────────────────────
  yield {
    step: 'verdict.final',
    status: 'running',
    summary: 'Composing final verdict…',
    payload: {},
  };

  const verdict = verdictFromRisk({ conflicts, riskScore, modelVerdict: preliminaryVerdict });
  const finalPayload = {
    verdict,
    riskScore,
    product: label.product,
    reasons,
    conflicts,
    alternatives,
    ingredientsSource: label.ingredientsSource || 'label',
    ingredientsSourceUrl: label.ingredientsSourceUrl || null,
    disclaimer:
      'Informational only — confirm with your doctor or pharmacist.',
  };

  yield {
    step: 'verdict.final',
    status: 'done',
    summary: `Verdict: ${verdict} (risk ${riskScore}/100)`,
    payload: finalPayload,
  };
}
