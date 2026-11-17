---
title: "Pulihkan ucapan rusak dengan model lokal"
description: "Tinjau hasil pemulihan ucapan opsional sebelum menerapkannya ke rekaman."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"id"} -->

Tinjau hasil pemulihan ucapan opsional sebelum menerapkannya ke rekaman.

## Sebelum memulai

Gunakan aplikasi desktop dan pilih ucapan yang ingin diperbaiki. Simpan sumber asli atau snapshot. Model yang ditampilkan untuk tugas ini bergantung pada katalog yang diterbitkan dan runtime terpasang; VoiceFixer mungkin tidak ditawarkan oleh build Anda.

## Langkah-langkah

1. Buka **Efek > Penghapusan dan perbaikan derau > Tingkatkan Dialog**.
2. Pilih **Model** yang kompatibel. Jika tersedia, **VoiceFixer** ditujukan untuk kliping dan pemulihan ucapan; instal secara eksplisit melalui kontrol model bila perlu.
3. Jalankan tugas, lalu pilih **Tinjau hasil** dan dengarkan audio usulan bersama sumber asli.
4. Terima usulan hanya jika ucapan membaik. Periksa penempatan yang dipilih sebelum menerapkannya, lalu simpan proyek.

## Periksa hasilnya

Dengarkan puncak yang telah diperbaiki dan ucapan yang lebih jelas, tetapi perhatikan juga perubahan vokal, napas, dan suara latar. Hasil yang diterima menjadi edit audio yang dapat Anda dengarkan dan batalkan; menolak atau menutup peninjauan tidak menerapkannya.

## Batasan dan pemulihan

VoiceFixer menyintesis ulang ucapan sehingga dapat mengubah timbre dan isi latar. Ini bukan alat umum untuk memperbaiki kliping musik. Jika tidak ada di pemilih model, gunakan penyempurna yang ditawarkan atau [panduan perbaikan puncak terkliping](/guides/cleaning-up/restore-clipped-peaks/); model yang tidak ditawarkan tidak dapat diaktifkan hanya dengan mengikuti langkah ini.
