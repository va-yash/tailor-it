import { MODELS, EFFORT } from './_lib.js';

// Read-only. Tells the browser which models the deployment is actually running
// so the answer to "which model is this using?" is visible in the app instead
// of buried in an environment variable somewhere.
//
// Deliberately exposes no secrets — only the model names and effort levels,
// plus whether a key is present at all (true/false, never the key itself).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Cache-Control', 'public, max-age=300');
  if (req.method === 'OPTIONS') return res.status(200).end();

  return res.status(200).json({
    models: MODELS,
    effort: EFFORT,
    apiKeyConfigured: Boolean(process.env.ANTHROPIC_API_KEY),
    usageWebhook: Boolean(process.env.USAGE_WEBHOOK_URL),
  });
}
