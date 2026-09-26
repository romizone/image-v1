// Server lokal (opsional) — memakai handler yang sama dengan Vercel (folder api/).
// Jalankan: OPENROUTER_API_KEY=sk-or-... node server.js   lalu buka http://localhost:3000
// Di Vercel file ini tidak dipakai; Vercel langsung menjalankan api/*.js sebagai serverless function.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import health from './api/health.js';
import or from './api/or.js';
import screenshot from './api/screenshot.js';

const PORT = process.env.PORT || 3000;
if (!(process.env.OPENROUTER_API_KEY || process.env.imagekey)) console.warn('Peringatan: OPENROUTER_API_KEY belum diisi, fitur AI akan gagal.');

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '30mb' }));

app.get('/api/health', health);
app.all('/api/or/*', or);
app.get('/api/screenshot', screenshot);
app.use(express.static(dir));

app.listen(PORT, () => console.log(`Olah berjalan di http://localhost:${PORT}`));
