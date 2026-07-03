/**
 * List Nebius models and pick vision-capable IDs.
 * Usage: node --env-file=.env scripts/check-nebius.js
 */
import { listNebiusModels } from '../cloud-functions/_lib/llm.js';

const VISION_HINTS = /vl|vision|llava|pixtral|gemma-3|qwen2\.5-vl|qwen2-vl|internvl/i;

const models = await listNebiusModels();
const vision = models.filter((id) => VISION_HINTS.test(id)).sort();
const preferred = [
  'Qwen/Qwen2.5-VL-72B-Instruct',
  'Qwen/Qwen2-VL-72B-Instruct',
  'Qwen/Qwen2.5-VL-7B-Instruct',
  'Qwen/Qwen2-VL-7B-Instruct',
].filter((id) => models.includes(id));

console.log(`total models: ${models.length}`);
console.log('vision-like models:');
for (const id of vision) console.log(' ', id);
console.log('preferred available:', preferred[0] || '(none of the preferred list)');
if (preferred[0]) {
  console.log(`\nSet VISION_MODEL=${preferred[0]}`);
}
