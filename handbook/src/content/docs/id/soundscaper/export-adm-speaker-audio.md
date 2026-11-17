---
title: "Render program ADM untuk speaker"
description: "Ekspor bed dan objek ADM yang dibuat sebagai audio speaker biasa menggunakan EBU EAR."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"id"} -->

Ekspor bed dan objek ADM yang dibuat sebagai audio speaker biasa menggunakan EBU EAR.

## Sebelum memulai

Buat program ADM di tab ADM pada Metadata editor, dengan penetapan bed dan objek yang sudah diposisikan. Ketahui tata letak speaker untuk pengiriman dan pilih kontainer serta codec yang mampu memuat jumlah kanalnya.

## Langkah-langkah

1. Buka **Berkas > Ekspor audio**.
2. Di bawah **Render > EBU EAR speaker rendering**, pilih tata letak: stereo, 5.1, 5.1.2, 5.1.4, 7.1, atau 7.1.4.
3. Periksa format keluaran, jumlah kanal, dan pengaturan tingkat, lalu ekspor.
4. Baca laporan pengiriman dan dengarkan berkas yang diekspor melalui tata letak speaker yang sesuai.

## Periksa hasilnya

Keluaran berisi PCM speaker yang dirender dalam urutan kanal yang dinyatakan. Pilihan ekspor ini tidak mengubah pemantauan proyek atau pembuatan ADM aslinya. Periksa laporan untuk mengetahui perender dan tata letak yang digunakan.

## Batasan dan pemulihan

Rendering speaker EAR dan rendering headphone tidak dapat digabungkan. Keluaran terpisah serta passthrough BW64/ADM tidak dapat menggunakan opsi ini. Kanal hasil render tidak membawa metadata ADM bed/object asli; gunakan BW64 tanpa render untuk pertukaran tersebut. Objek bergerak atau difus, HOA, manajemen bass, dan rendering Dolby tersertifikasi berada di luar fitur ini. Meter kenyaringan biasa mendukung paling banyak delapan kanal keluaran.
