---
title: "Samakan nada rekaman suara"
description: "Pelajari referensi tonal dan gunakan Match EQ agar rekaman lain lebih mendekatinya."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"id"} -->

Pelajari referensi tonal dan gunakan Match EQ agar rekaman lain lebih mendekatinya.

## Sebelum memulai

Pilih referensi yang terdengar dan memiliki rentang frekuensi penuh, setidaknya seperempat detik; sebaiknya gunakan pembicara yang sama dengan rekaman yang bagus. Siapkan rekaman target. Pemrosesan lokal ini tersedia di browser maupun desktop.

## Langkah-langkah

1. Pilih referensi dan buka **Efek > EQ dan filter > Match EQ**. Pilih **Learn reference from selection**.
2. Simpan referensi yang dipelajari sebagai preset jika ingin menggunakan kembali profil suara ini. Tutup dialog.
3. Pilih target, buka Match EQ lagi, panggil referensi jika perlu, lalu pilih **Analyze target**.
4. Bandingkan **Asli** dan **Matched (level compensated)** dengan **Pratinjau**. Sesuaikan koreksi, lalu pilih **Terapkan ke pilihan** atau **Edit as Filter Curve EQ** untuk mengedit kurva.

## Periksa hasilnya

Dengarkan dengan kenyaringan yang serupa untuk membandingkan keseimbangan tonal. Audio hasil penerapan mempertahankan durasi dan jumlah kanalnya. **Urungkan** membatalkan penerapan.

## Batasan dan pemulihan

Match EQ tidak dapat memulihkan rentang frekuensi yang hilang atau menyamakan penampilan, dinamika, gema ruangan, maupun identitas suara. Pengambilan referensi mencakup efek trek sebelum bus dan master; target dianalisis sebelum rak treknya. Render referensi terlebih dahulu bila suara yang diinginkan bergantung pada pemrosesan sesudahnya.
