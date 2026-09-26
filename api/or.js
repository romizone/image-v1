// Proxy OpenRouter: /api/or/chat/completions -> https://openrouter.ai/api/v1/chat/completions
// API key tersimpan di server (env OPENROUTER_API_KEY), tidak pernah dikirim ke browser.
import { allow, tooMany } from '../lib/limit.js';

const ALLOWED = new Set(['/chat/completions', '/models']);

export default async function handler(req, res) {
  const KEY = process.env.OPENROUTER_API_KEY || process.env.imagekey;
  if (!KEY) return res.status(500).json({ error: { message: 'OPENROUTER_API_KEY belum diisi di server.' } });
  if (!allow(req, 'or', 20, 60_000)) return tooMany(res);

  // Vercel (rewrite di vercel.json): req.query.path = 'chat/completions'; Express (server.js): req.params[0] = 'chat/completions'
  const seg = req.query?.path ?? req.params?.[0] ?? '';
  const p = '/' + (Array.isArray(seg) ? seg.join('/') : String(seg)).replace(/^\/+/, '');
  if (!ALLOWED.has(p)) return res.status(404).json({ error: { message: 'Endpoint tidak diizinkan' } });
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: { message: 'Metode tidak didukung' } });

  try {
    const r = await fetch('https://openrouter.ai/api/v1' + p, {
      method: req.method,
      headers: {
        Authorization: `Bearer ${KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost'),
        'X-Title': 'Image V.1',
      },
      body: req.method === 'POST' ? JSON.stringify(req.body ?? {}) : undefined,
    });
    res.status(r.status).setHeader('Content-Type', r.headers.get('content-type') || 'application/json');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.status(502).json({ error: { message: e.message } });
  }
}
