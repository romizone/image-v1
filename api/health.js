// GET /api/health          — deteksi mode server (cepat, tanpa panggilan keluar)
// GET /api/health?check=1  — sekaligus uji key OpenRouter sungguhan (endpoint /key, tidak memakai kredit)
const KEY = () => process.env.OPENROUTER_API_KEY || process.env.imagekey;

let cache = { at: 0, ai: null };
const TTL = 60_000;

async function checkAi() {
  if (!KEY()) return { ok: false, reason: 'Key AI belum dipasang di server' };
  if (Date.now() - cache.at < TTL && cache.ai) return cache.ai;
  let ai;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${KEY()}` }, signal: AbortSignal.timeout(6_000) });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 403) ai = { ok: false, reason: 'Key AI tidak valid atau sudah dicabut' };
    else if (!r.ok) ai = { ok: false, reason: 'Layanan AI tidak merespons (HTTP ' + r.status + ')' };
    else if (d.data?.limit_remaining != null && d.data.limit_remaining <= 0) ai = { ok: false, reason: 'Kredit AI habis' };
    else ai = { ok: true };
  } catch {
    ai = { ok: false, reason: 'Layanan AI tidak dapat dihubungi' };
  }
  cache = { at: Date.now(), ai };
  return ai;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const out = { ok: true, ai: !!KEY(), screenshot: true, convert: false };
  if (req.query?.check === '1') {
    const a = await checkAi();
    out.ai = a.ok; if (!a.ok) out.aiReason = a.reason;
  }
  res.status(200).json(out);
}
