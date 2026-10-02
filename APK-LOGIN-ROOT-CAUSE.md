# Akar masalah login Stockity — Newton Prime 1.2.26

## Ringkasan

Worker lama belum mengikuti alur autentikasi yang dipakai aplikasi Android. Ketidakcocokan paling penting adalah body/header login yang berbeda dan tidak adanya penyelesaian challenge 2FA. Ini merupakan temuan kuat pada tingkat implementasi, tetapi bukan bukti respons live dari akun Stockity tertentu: tidak ada kredensial nyata yang dipakai dan login live tidak dicoba.

## Metode pemeriksaan

Berkas `Newton+Prime_1.2.26_APKPure.xapk` diekstrak dan diperiksa secara statis. Paket berisi aplikasi Flutter; `libapp.so` ARM64 dianalisis dengan Blutter untuk membaca dump assembly/pseudocode Dart, terutama `AuthService` dan halaman login. APK tidak dipasang atau dijalankan, dan request dari akun tidak direplay.

## Kontrak yang ditemukan

Konfigurasi aplikasi memuat host `https://api.stockity1.id` dan `https://api.stockity1.com`. Sign-in awal menggunakan `POST /passport/v2/sign_in` dengan header `Content-Type: application/json`, `Device-Id`, serta `Device-Type: web`. Body-nya hanya berisi `email` dan `password`; APK tidak menambahkan objek `device`, header `Origin`, atau `Authorization-Version` pada request login tersebut. Respons sukses dibaca dari `authtoken` dan `user_id`.

Untuk akun yang meminta verifikasi dua faktor, urutannya adalah tiga request berikut:

| Tahap | Endpoint dan isi | Hasil yang dipakai langkah berikutnya |
|---|---|---|
| Sign-in awal | `POST /passport/v2/sign_in`; body `email`, `password`; header perangkat | Status 422 dengan `errors[].code = 2fa_required`, serta cookie challenge dari `Set-Cookie` |
| Validasi OTP | `POST /passport/v1/2fa/validate/otp?locale=id`; body `otp`; header perangkat dan cookie challenge | `data.2fa_token`; respons dapat memperbarui cookie challenge |
| Sign-in ulang | `POST /passport/v2/sign_in`; body `email`, `password`, `2fa_token`; header perangkat dan cookie challenge | Token sesi akhir `authtoken` dan `user_id` |

Dengan demikian, `2fa_token` bukan token sesi final. APK meminta OTP, menukar OTP menjadi `2fa_token`, lalu melakukan sign-in lagi. Password tidak perlu disimpan oleh Worker untuk alur ini.

## Akar masalah dan perbaikan

| Area | Ketidakcocokan/risiko sebelumnya | Perubahan |
|---|---|---|
| Sign-in | Worker menambahkan `device` ke body serta mengirim `Origin` dan `Authorization-Version`; bentuk itu tidak cocok dengan request sign-in APK | Worker sekarang mengirim body dan header inti sebagaimana diamati di APK, lalu mensyaratkan `authtoken` dan `user_id` sebelum membuat sesi |
| 2FA | Worker mengembalikan kegagalan saat akun meminta OTP dan tidak menyediakan langkah validasi | Route `/api/auth/2fa` menjalankan validasi OTP lalu sign-in ulang. Tantangan disegel dalam cookie AES-GCM `HttpOnly` selama lima menit; password hanya diteruskan sementara melalui HTTPS dan tidak disimpan dalam cookie |
| UI | Form web hanya mengirim email/password satu kali | Form menampilkan input OTP hanya setelah server menyatakan `twoFactorRequired` |
| Proxy API | Proxy lama menyalin header request browser—termasuk cookie sesi Newton Prime—dan tidak membatasi method ke GET | Proxy sekarang membentuk header upstream baru, tidak meneruskan cookie Worker, dan hanya mengizinkan endpoint read-only dengan method GET |
| Order | Endpoint order belum memiliki kontrak terverifikasi | `/api/trade` tetap tidak mengirim order: mode terkunci memberi 423 dan adapter tetap mengembalikan 501 jika dibuka |

Worker menggunakan `.id` sebagai host default dan mencoba `.com` hanya untuk gangguan jaringan atau respons 5xx. Jika `STOCKITY_API_BASE` dikonfigurasi, host itu menjadi satu-satunya host yang dipakai.

## Validasi

| Pemeriksaan | Hasil |
|---|---|
| `npm run typecheck` | Lulus |
| `npm run build` | Lulus |
| `git diff --check` | Lulus |
| Mock login tanpa 2FA | Lulus: respons `authtoken`/`user_id` diterima dan token disegel dalam cookie |
| Mock challenge → OTP → sign-in ulang | Lulus: `2fa_token` dan cookie challenge diteruskan pada langkah yang tepat |
| Keamanan batas demo/proxy | Lulus: trade tidak memanggil Stockity, POST proxy ditolak, cookie Newton Prime tidak diteruskan pada GET |

Seluruh pengujian protokol memakai `fetch` mock lokal, bukan host Stockity. Tidak ada kredensial, OTP, token, atau order nyata yang digunakan.

## Batasan

Kontrak ini diambil dari APK yang dilampirkan, bukan dokumentasi publik resmi yang menjamin API stabil. Stockity dapat mengubah endpoint atau schema. Setelah kode dipublikasikan, pemilik akun perlu menguji login sendiri melalui situs; password atau OTP tidak boleh dikirim melalui chat. Perubahan ini memperbaiki autentikasi saja dan tidak mengaktifkan order demo maupun live.


## Tindak lanjut dari screenshot login

Screenshot pengguna memperlihatkan bahwa API Stockity menolak request karena header `User-Agent` tidak ada. Walaupun request sign-in yang terlihat langsung di `AuthService` tidak menetapkan header itu secara eksplisit, APK memuat User-Agent Android Newton Prime yang digunakan oleh lapisan aplikasinya. Worker kini meneruskan User-Agent browser yang diterima; bila header itu tidak tersedia, Worker memakai nilai Android Newton Prime yang ditemukan pada APK. Header tersebut dikirim pada sign-in awal, validasi OTP, dan sign-in ulang.

Screenshot juga menunjukkan field OTP tampil sebelum challenge. Penyebabnya adalah aturan `.login-card label { display: block; }` menimpa atribut HTML `hidden`. CSS kini menambahkan aturan spesifik agar field itu tetap tidak terlihat sampai server meminta OTP.

Setelah hotfix, `npm run typecheck`, `npm run build`, dan `git diff --check` lulus. Mock menegaskan bahwa browser User-Agent diteruskan di ketiga request OTP, fallback APK digunakan saat User-Agent tidak tersedia, dan field OTP tersembunyi pada CSS hasil build. Login live belum dites dengan kredensial akun.