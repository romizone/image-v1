// Rate limit sederhana per IP, disimpan di memori.
// Di Vercel setiap instance punya memori sendiri dan bisa di-reset, jadi ini hanya
// pengaman ringan. Untuk batas yang ketat, pakai Upstash Redis / Vercel KV.
const hits = new Map();

export function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  return (typeof xf === 'string' ? xf.split(',')[0].trim() : '') || req.socket?.remoteAddress || 'unknown';
}

/** true bila masih boleh, false bila sudah melewati batas */
export function allow(req, bucket, max, windowMs) {
  const k = clientIp(req) + '|' + bucket; const now = Date.now();
  const h = (hits.get(k) || []).filter(t => now - t < windowMs); h.push(now); hits.set(k, h);
  if (hits.size > 5000) for (const [key, arr] of hits) if (arr.every(t => now - t >= windowMs)) hits.delete(key);
  return h.length <= max;
}

export function tooMany(res) {
  res.status(429).json({ error: { message: 'Terlalu banyak permintaan, coba lagi sebentar.' } });
}
