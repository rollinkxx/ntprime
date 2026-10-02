

## Tindak lanjut dari screenshot respons login

Pesan kedua pada screenshot berasal dari validasi Worker sendiri setelah Stockity mengembalikan respons sukses HTTP tetapi parser Worker tidak menemukan field sesi. Pemeriksaan bytecode APK menunjukkan bahwa sign-in memang membuka properti tingkat atas `data` terlebih dahulu, kemudian membaca `data.authtoken` dan `data.user_id`. Worker lama mencari kedua properti langsung di root respons; karena itu ia salah menganggap sesi tidak lengkap.

Parser hotfix kini membuka wrapper `data` untuk sign-in langsung maupun sign-in sesudah OTP, dengan fallback ke bentuk root apabila upstream tidak membungkusnya. Error yang ditampilkan ke pengguna tidak lagi membocorkan asumsi internal parser. Ini adalah temuan bentuk respons yang spesifik dari APK, bukan nilai token atau data akun.
