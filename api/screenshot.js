// GET /api/screenshot?url=&width=&scale=&full=&type= — HTML ke Gambar mode URL.
// Di Vercel memakai @sparticuz/chromium (Chromium ringan untuk serverless);
// di lokal memakai Chrome yang terpasang (env CHROME_PATH atau lokasi umum).
import dns from 'node:dns/promises';
import net from 'node:net';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { allow, tooMany } from '../lib/limit.js';

const isPrivate = (ip) => net.isIPv6(ip)
  ? /^(::1|fc|fd|fe80|::ffff:(127|10|192\.168|169\.254))/i.test(ip)
  : /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

const LOCAL_CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
];

// Response function Vercel maksimal 4,5 MB; sisakan ruang untuk header
const MAX_BYTES = 4_200_000;
// Tinggi maksimal halaman penuh (px CSS), agar gambar tidak raksasa
const MAX_FULL_HEIGHT = 10_000;
// Batas piksel perangkat per tangkapan (lebar x tinggi x skala^2). Serverless tanpa GPU
// merender sekitar 1 juta piksel/detik, jadi batasnya lebih kecil di Vercel.
const SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const MAX_PIXELS = SERVERLESS ? 10_000_000 : 24_000_000;
const PX_PER_MS = SERVERLESS ? 800 : 5_000;
// Di atas ini PNG hampir pasti > 4 MB, jadi langsung JPEG (hemat satu kali tangkap ulang)
const PNG_MAX_PIXELS = 5_000_000;
// Waktu memuat halaman sebelum tetap dipotret apa adanya
const LOAD_BUDGET_MS = 15_000;
// Batas total per permintaan (function Vercel dibatasi maxDuration 60 detik)
const DEADLINE_MS = 45_000;

async function launch() {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const { default: chromium } = await import('@sparticuz/chromium');
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const executablePath = process.env.CHROME_PATH || LOCAL_CHROME.find(p => fs.existsSync(p));
  if (!executablePath) throw new Error('Chrome tidak ditemukan. Isi env CHROME_PATH dengan lokasi Chrome/Chromium.');
  return puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
}

/** Muat halaman secukupnya: tunggu DOM, lalu 'load' dan jaringan tenang secara best-effort.
 *  Situs penuh iklan tidak pernah benar-benar diam, jadi jangan gagal hanya karena itu. */
async function load(page, url) {
  const t0 = Date.now(); const left = () => Math.max(500, LOAD_BUDGET_MS - (Date.now() - t0));
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: LOAD_BUDGET_MS });
  } catch (e) {
    // Lambat tapi sudah ada isi: tetap potret apa yang sudah tampil
    const hasContent = e?.name === 'TimeoutError' && await page.evaluate(() => (document.body?.innerText || '').trim().length > 50).catch(() => false);
    if (!hasContent) throw e;
    return;
  }
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(8_000, left()) }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 500, timeout: Math.min(4_000, left()) }).catch(() => {});
}

/** Gulir perlahan agar gambar lazy-load ikut termuat, lalu kembali ke atas */
async function autoScroll(page, maxHeight, ms) {
  await page.evaluate(async (maxH, ms) => {
    const step = window.innerHeight; const end = Date.now() + ms;
    for (let y = 0; y < Math.min(document.documentElement.scrollHeight, maxH) && Date.now() < end; y += step) {
      window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120));
    }
    window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 300));
  }, maxHeight, ms).catch(() => {});
  // halaman yang sibuk (skrip iklan) bisa menahan evaluate; jangan tunggu lebih dari ms + 1 detik
}
async function autoScrollCapped(page, maxHeight, ms) {
  await Promise.race([autoScroll(page, maxHeight, ms), new Promise(r => setTimeout(r, ms + 1_000))]);
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/ERR_NAME_NOT_RESOLVED|ENOTFOUND/.test(m)) return 'Alamat situs tidak ditemukan. Periksa kembali URL-nya.';
  if (/ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_BLOCKED/.test(m)) return 'Situs ini menolak akses dari layanan screenshot otomatis. Coba situs lain, atau simpan halamannya sebagai HTML lalu pakai mode Kode HTML.';
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_ADDRESS_UNREACHABLE/.test(m)) return 'Situs tidak dapat dihubungi.';
  if (/ERR_CERT/.test(m)) return 'Sertifikat HTTPS situs ini tidak valid.';
  if (/timeout/i.test(m)) return 'Situs terlalu lama merespons. Coba lagi, atau matikan opsi Halaman penuh.';
  return m;
}

export default async function handler(req, res) {
  if (!allow(req, 'shot', 10, 60_000)) return tooMany(res);
  const t0 = Date.now(); const left = () => DEADLINE_MS - (Date.now() - t0);
  const marks = []; let tm = t0; const mark = (n) => { const now = Date.now(); marks.push(`${n};dur=${now - tm}`); tm = now; };
  let browser;
  try {
    let u;
    try { u = new URL(String(req.query.url || '')); } catch { throw new Error('URL tidak valid'); }
    if (!/^https?:$/.test(u.protocol)) throw new Error('URL harus http atau https');
    const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => { throw new Error('ENOTFOUND'); });
    if (addrs.some(a => isPrivate(a.address))) throw new Error('Alamat jaringan privat tidak diizinkan');
    const width = Math.min(3840, Math.max(320, +req.query.width || 1280));
    const scale = Math.min(3, Math.max(1, +req.query.scale || 1));
    const full = req.query.full === '1';
    let type = req.query.type === 'jpeg' ? 'jpeg' : 'png';

    browser = await launch(); mark('launch');
    const page = await browser.newPage();
    // UA Chrome biasa (tanpa "HeadlessChrome") agar situs menyajikan tampilan normal
    const ua = (await browser.userAgent()).replace('HeadlessChrome', 'Chrome');
    await page.setUserAgent(ua);
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8' });
    await page.setViewport({ width, height: 800, deviceScaleFactor: scale });
    // Setiap pengalihan/permintaan ke jaringan privat diblokir (cegah SSRF lewat redirect)
    await page.setRequestInterception(true);
    page.on('request', r => {
      let h; try { h = new URL(r.url()).hostname; } catch { return r.continue(); }
      if (net.isIP(h) && isPrivate(h) || h === 'localhost') return r.abort('blockedbyclient');
      r.continue();
    });

    await load(page, u.href); mark('load');

    let height = 800;
    if (full) {
      if (left() > 25_000) await autoScrollCapped(page, MAX_FULL_HEIGHT, Math.min(2_000, left() - 23_000));
      const h = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body?.scrollHeight || 0));
      // Chrome membatasi tekstur ~16384 px piksel perangkat; lebih dari itu isi halaman terulang
      mark('scroll');
      // anggaran piksel ikut sisa waktu, sisakan ~8 detik untuk encode dan kirim
      const budget = Math.min(MAX_PIXELS, Math.max(2_000_000, (left() - 8_000) * PX_PER_MS));
      height = Math.min(Math.max(h, 800), MAX_FULL_HEIGHT, Math.floor(16_000 / scale), Math.floor(budget / (width * scale * scale)));
    }
    // Halaman penuh: perbesar viewport setinggi area yang diambil. Jauh lebih cepat daripada
    // captureBeyondViewport, yang merender SELURUH halaman (Wikipedia: 80.000 px, 40+ detik).
    const resize = async (hh) => { await page.setViewport({ width, height: hh, deviceScaleFactor: scale }); await new Promise(r => setTimeout(r, 400)); };
    const shoot = (t, quality) => page.screenshot({ type: t, quality: t === 'jpeg' ? quality : undefined });
    if (height !== 800) await resize(height);

    let note = '';
    if (type === 'png' && width * scale * scale * height > PNG_MAX_PIXELS) { type = 'jpeg'; note = 'png-ke-jpeg'; }
    let buf = await shoot(type, 82); mark('shot');
    // Jaga agar muat di batas response Vercel: PNG -> JPEG, turunkan kualitas, lalu potong tinggi
    if (buf.length > MAX_BYTES && type === 'png') { type = 'jpeg'; note = 'png-ke-jpeg'; buf = await shoot('jpeg', 82); }
    if (buf.length > MAX_BYTES && left() > 8_000) { buf = await shoot('jpeg', 60); note ||= 'kualitas-diturunkan'; }
    while (buf.length > MAX_BYTES && height > 2_000 && left() > 5_000) {
      height = Math.round(height * 0.6); await resize(height); buf = await shoot('jpeg', 60); type = 'jpeg'; note = 'dipotong';
    }
    if (buf.length > MAX_BYTES) throw new Error('Hasil tangkapan terlalu besar. Kecilkan lebar layar atau skala, atau matikan Halaman penuh.');

    res.status(200).setHeader('Content-Type', 'image/' + type);
    res.setHeader('Cache-Control', 'no-store');
    if (note) res.setHeader('X-Olah-Note', note);
    mark('retry'); res.setHeader('Server-Timing', marks.join(', '));
    res.send(Buffer.from(buf));
  } catch (e) {
    res.status(400).send(friendly(e));
  } finally {
    // Serverless: tutup browser setiap request (instance bisa mati kapan saja)
    if (browser) await browser.close().catch(() => {});
  }
}
