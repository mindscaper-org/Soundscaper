---
title: "Kurangi derau saat pemutaran"
description: "Tambahkan efek pengurangan derau AI waktu nyata ke trek dialog."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"id"} -->

Tambahkan efek pengurangan derau AI waktu nyata ke trek dialog.

## Sebelum memulai

Gunakan Soundscaper desktop. Buka **Alat > Manajer Model** dan instal model pengurangan derau waktu nyata beserta runtime yang cocok dan ditawarkan oleh build Anda. Pemasangan model adalah unduhan eksplisit; browser saja tidak dapat menjalankan efek native ini.

## Langkah-langkah

1. Pilih trek dialog yang bising dan buka rak efek waktu nyatanya.
2. Pilih **Tambahkan efek**, lalu pilih **AI denoising (DPDFNet2)**.
3. Mulai pemutaran dan bandingkan dengan efek yang dinonaktifkan menggunakan tombol dayanya.
4. Sesuaikan miks di sekitar trek yang dibersihkan dan dengarkan hasil ekspor sebelum mengirimkannya. Simpan proyek untuk mempertahankan rak tersebut.

## Periksa hasilnya

Derau seharusnya berkurang sementara ucapan tetap dapat dipahami. Periksa konsonan pelan, napas, dan awal pemutaran. Jika terdengar naik-turun atau ada ucapan yang hilang, nonaktifkan efek dan bandingkan dengan sumber asli.

## Batasan dan pemulihan

Ini adalah pengurangan derau ucapan, bukan efek pemulihan musik umum. Pemutaran di komputer lain memerlukan model dan runtime native yang kompatibel. Jika efek tidak tersedia, periksa pemasangan dan dukungan desktop; gunakan [pemulihan ucapan offline](/soundscaper/restore-damaged-speech/) jika Anda memerlukan hasil render yang sudah ditinjau. Unduhan model tidak menjamin semua rekaman akan membaik.
