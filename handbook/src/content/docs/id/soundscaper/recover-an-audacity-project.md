---
title: "Pulihkan audio dari proyek Audacity yang rusak"
description: "Nilai proyek yang rusak dan simpan pekerjaan yang dipulihkan sebagai salinan terpisah."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"id"} -->

Nilai proyek yang rusak dan simpan pekerjaan yang dipulihkan sebagai salinan terpisah.

## Sebelum memulai

Buat salinan proyek Audacity yang rusak terlebih dahulu. Simpan semua berkas samping yang tersedia di tempat yang sama. Pemulihan dapat menangani `.aup3` yang didukung dan berkas proyek Audacity yang belum disimpan, tetapi tidak dapat membuat ulang sampel yang sudah tidak ada.

## Langkah-langkah

1. Buka **Berkas > Pengelolaan proyek > Pulihkan proyek Audacity**.
2. Pilih proyek yang rusak. Baca **Recovery assessment** sebelum mengimpor atau menyimpan apa pun.
3. Periksa **Missing audio ranges**, termasuk halaman tambahan berisi lokasi terdampak.
4. Jika tersedia, pilih **Save repaired Audacity copy**. Jika tidak, buka hasil pemulihan, tinjau laporan kompatibilitas, lalu simpan pekerjaan dengan nama baru.

## Periksa hasilnya

Putar bagian yang dipulihkan dan periksa celah atau keheningan berdasarkan laporan. Pastikan salinan baru dapat dibuka sebelum mengandalkannya. Simpan berkas rusak asli untuk percobaan pemulihan lain.

## Batasan dan pemulihan

Pemulihan mungkin dapat menyelamatkan awalan audio yang valid dan mengganti sampel yang hilang dengan keheningan. Basis data yang diperbaiki tidak berarti seluruh audio selamat atau semua fitur penyuntingan native dapat dipindahkan. Baca penghilangan yang dilaporkan dan jangan pernah menimpa satu-satunya berkas asli saat mendiagnosis. Untuk proyek utuh biasa, gunakan [panduan impor Audacity](/guides/projects/open-an-audacity-project/).
