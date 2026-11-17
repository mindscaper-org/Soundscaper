---
title: "Periksa suara saat diputar"
description: "Gunakan panel Analysis untuk spektrum langsung, kenyaringan, pemeriksaan stereo, dan laporan audio ACX."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"id"} -->

Gunakan panel Analysis untuk spektrum langsung, kenyaringan, pemeriksaan stereo, dan laporan audio ACX.

## Sebelum memulai

Buka proyek yang berisi audio. Tentukan apakah Anda ingin memeriksa pemutaran atau rentang terpilih: pilihan waktu dapat mengalihkan spektrum ke analisis pilihan.

## Langkah-langkah

1. Buka **Analisis > Analisis**. Perluas bagian yang diperlukan, seperti **Spectrum**, spektrogram, kenyaringan, atau korelasi.
2. Hapus pilihan waktu dan mulai pemutaran untuk tampilan langsung. Bandingkan lapisan trek pada spektrum untuk menemukan pita frekuensi yang saling bersaing.
3. Hentikan pemutaran dan pilih bagian untuk memeriksa spektrumnya tanpa pemutaran.
4. Untuk pemeriksaan buku audio, perluas **ACX compliance** dan pilih **Check audio**. Baca tabel hasil; gunakan **Ekspor** untuk laporan JSON.

## Periksa hasilnya

Tampilan langsung merespons pemutaran. Laporan ACX mencantumkan lulus atau gagal untuk pemeriksaan audionya, bukan sekadar menampilkan meter. Perbaiki tingkat atau pengaturan format yang gagal, lalu periksa lagi.

## Batasan dan pemulihan

Spektrum menunjukkan energi, bukan apakah miks terdengar bagus. Korelasi dan kenyaringan memerlukan konteks serta pendengaran. Pemeriksaan audio ACX tidak menjamin penerimaan layanan penerbitan atau memeriksa semua persyaratan editorial. Menutup bagian ACX akan menghapus hasil pemeriksaan yang ditampilkan; jalankan lagi bila perlu. Tutup bagian penganalisis yang tidak diperlukan untuk mengurangi beban tampilan.
