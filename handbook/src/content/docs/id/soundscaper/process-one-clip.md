---
title: "Terapkan efek waktu nyata ke satu klip"
description: "Beri satu klip audio rak efek sendiri tanpa memproses semua klip di treknya."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"id"} -->

Beri satu klip audio rak efek sendiri tanpa memproses semua klip di treknya.

## Sebelum memulai

Pilih klip audio di Soundscaper. Efek klip merupakan bagian dari pemrosesan klip tersebut dan masuk ke efek trek; pemrosesan trek dan master tetap dapat mengubah suara yang Anda dengar.

## Langkah-langkah

1. Buka **Jendela > Properti klip**, lalu perluas **Efek**. Ini adalah rak efek klip.
2. Pilih **Tambahkan efek**, pilih efek, lalu atur parameternya. Putar klip untuk mendengarkan pratinjau.
3. Gunakan tombol daya efek untuk membandingkan suara saat dinonaktifkan dan diproses. Susun ulang atau hapus efek di rak sesuai kebutuhan.
4. Simpan proyek, lalu dengarkan klip bersama klip di sekitarnya. Gunakan **Urungkan** jika perubahan tidak membantu.

## Periksa hasilnya

Klip yang dipilih memiliki pemrosesan sendiri, sedangkan klip lain mempertahankan pengaturannya. Dengarkan setelah akhir klip untuk mengetahui ekor reverb atau delay; periksa rak trek jika hasil gabungannya terlalu kuat.

## Batasan dan pemulihan

Ekor efek dapat melewati audio sumber klip; periksa opsi ekor saat mengekspor sebelum menyerahkan hasil. Untuk detektor Auto Duck, pilih trek lain yang sesuai; umpan balik ditolak. Buka **Opsi lainnya > Auto-idle** pada header efek untuk mengatur prosesor agar tidur saat hening. Nonaktifkan untuk plug-in yang peka waktu. Lihat [pemrosesan lokal](/help/local-processing/) untuk pengaturan terkait.
