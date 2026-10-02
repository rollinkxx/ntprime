
## Live chart dan paper Martingale

Setelah login Stockity, `/api/data/candles` mencoba mengambil candle 1-menit dari endpoint read-only Stockity melalui Worker. Frontend menandai sumber sebagai `Stockity API` hanya jika respons candle valid; tanpa login atau jika endpoint upstream gagal, UI memakai `demo fallback` dan menampilkannya secara eksplisit.

Engine order tetap **paper-only**: ia menyelesaikan posisi virtual memakai candle berikutnya, menghitung P/L lokal, dan tidak memanggil `/api/trade`. Martingale tersedia sebagai money-management paper dengan bid dasar, multiplier, batas maksimum K, reset ke K0 setelah WIN, kenaikan step setelah LOSS, tabel preview kompensasi, serta batas kerugian/jumlah trade harian.

Catatan: format endpoint candle Stockity dapat berubah dan response yang tidak cocok akan ditolak oleh normalizer; jangan menganggap fallback demo sebagai live feed. `SESSION_SECRET` harus aktif agar sesi login dan proxy read-only berfungsi.
