# Image V.1: 15 alat gambar di browser + AI (GPU server via OpenRouter)

Siap dideploy ke **Vercel** (paket Hobby gratis). Semua pemrosesan gambar non-AI terjadi di browser;
server hanya dipakai untuk proxy OpenRouter (agar API key aman) dan screenshot URL.

## Deploy ke Vercel

1. Push folder ini ke GitHub, lalu di Vercel klik **Add New Project** dan pilih repo-nya
   (atau dari terminal: `npx vercel`).
2. Framework Preset: **Other**. Biarkan Build Command kosong.
3. Di **Settings → Environment Variables** tambahkan:
   - `OPENROUTER_API_KEY` = `sk-or-v1-...` (wajib untuk fitur AI)
   - `SITE_URL` = `https://nama-proyek.vercel.app` (opsional, dikirim ke OpenRouter sebagai referer)
4. Deploy. Aplikasi otomatis mendeteksi `api/health` dan memakai proxy `api/or` serta `api/screenshot`.

## Jalan lokal

```bash
npm install
cp .env.example .env   # isi OPENROUTER_API_KEY
OPENROUTER_API_KEY=sk-or-v1-xxx node server.js
# buka http://localhost:3000
```

Atau `npx vercel dev` untuk meniru lingkungan Vercel. Screenshot lokal memakai Chrome yang terpasang
(otomatis dicari; bisa dipaksa lewat env `CHROME_PATH`).

## Struktur

| File | Fungsi |
|---|---|
| `index.html` | Seluruh aplikasi (frontend) |
| `api/health.js` | Deteksi mode server + apakah key AI tersedia |
| `api/or.js` | Proxy OpenRouter (`/chat/completions`, `/models`) |
| `api/screenshot.js` | HTML ke Gambar mode URL, Chromium serverless (`@sparticuz/chromium`) |
| `lib/limit.js` | Rate limit per IP (in-memory, pengaman ringan) |
| `server.js` | Server Express lokal yang memakai handler `api/` yang sama |
| `vercel.json` | Memori dan batas waktu function |

## Peta alat

| Alat | Mesin | AI (OpenRouter) |
|---|---|---|
| Pas foto | MediaPipe (wajib 1 wajah) + IS-Net hapus latar; 2×3, 3×4, 4×6, paspor; latar merah/biru/putih; lembar 4R; 300 DPI | - |
| Gaya Korea | MediaPipe (wajib 1 wajah) | Model gambar: gaya oppa / K-beauty, identitas wajah dijaga |
| Kompres | Canvas + UPNG (PNG), gifuct + gifenc (GIF animasi) | - |
| Ubah ukuran | Canvas, downscale bertahap | - |
| Potong | Cropper.js + preset media sosial | Model vision: potong pintar |
| Konversi ke JPG | Canvas + heic2any, UTIF (TIFF), ag-psd (PSD); ekstrak frame GIF | - |
| Konversi dari JPG | Canvas + gifenc (GIF animasi) | - |
| Editor foto | Canvas (filter, teks, stiker, bingkai, undo/redo) | Model gambar: edit via prompt |
| Perbesar resolusi | Resample + sharpen | Model gambar (opsional) |
| Hapus latar | @imgly/background-removal (IS-Net, WASM) | Model gambar + chroma key |
| Watermark | Canvas | - |
| Pembuat meme | Canvas + template orisinal | Model vision: caption |
| Putar | Canvas | - |
| HTML ke gambar | html2canvas (kode) / Chromium serverless (URL); PNG, JPG, SVG | - |
| Sensor wajah | MediaPipe Face Detector | Model vision: plat nomor/data pribadi |

## Batasan di Vercel

- **Request/response function maksimal 4,5 MB.** Gambar yang dikirim ke AI otomatis dikecilkan
  di browser (maks 1536 px, JPEG) agar tetap di bawah batas. Gambar hasil AI yang sangat besar bisa gagal.
- **RAW kamera belum didukung** (butuh ImageMagick/LibRaw, tidak tersedia di Vercel). TIFF dan PSD diproses di browser;
  PSD harus disimpan dengan "Maximize Compatibility" agar punya gambar gabungan.
- Screenshot URL: cold start 3–5 detik, batas 60 detik per request (paket Hobby).
- Rate limit disimpan di memori, jadi hanya berlaku per instance. Untuk batas yang ketat
  pakai Upstash Redis (tersedia gratis di Vercel Marketplace).

## Catatan

- Pilih model di Pengaturan AI lewat tombol "Muat daftar model"; nama model OpenRouter sering berubah.
- Tanpa key di server, pengguna tetap bisa mengisi API key sendiri di Pengaturan AI (tersimpan di browser).
- Upscale kualitas profesional (Real-ESRGAN) sebaiknya dikerjakan di server GPU.

## Status AI untuk pengguna

Pengguna tidak pernah mengisi API key. Tombol di kanan atas menampilkan **AI aktif** (hijau) atau
**AI tidak aktif** (merah) berdasarkan uji key sungguhan ke `/api/health?check=1` (tidak memakai kredit),
dicek ulang tiap 5 menit. Arahkan kursor ke tombol untuk melihat alasannya; klik saat merah untuk cek ulang.
Admin bisa membuka dialog pengaturan lama dengan **Shift + klik** tombol tersebut.
