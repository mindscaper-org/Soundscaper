---
title: "Gunakan kembali proyek tersimpan sebagai audio tertaut"
description: "Sisipkan proyek tersimpan ke susunan lain dan ikuti perubahan berikutnya."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"id"} -->

Sisipkan proyek tersimpan ke susunan lain dan ikuti perubahan berikutnya.

## Sebelum memulai

Simpan proyek Soundscaper anak dalam pustaka proyek lokal yang sama. Selesaikan miksnya terlebih dahulu. Render dan terapkan pemrosesan plug-in native yang aktif ke audio sebelum menggunakan perender subproyek latar belakang.

## Langkah-langkah

1. Buka proyek induk, lalu pilih **Berkas > Subprojects**.
2. Pilih proyek anak di bawah **Project to insert or relink**, lalu pilih **Insert subproject**. Miks yang dipublikasikan akan muncul di trek baru.
3. Pilih tautan di bawah **Linked subprojects**, lalu pilih **Open subproject** untuk mengedit proyek anak. Simpan, kemudian kembali ke induk untuk mendengarkan audio yang diperbarui.
4. Pilih **Pin current audio** untuk mempertahankan revisi ini, atau **Make independent audio** agar tidak lagi mengikuti proyek anak.

## Periksa hasilnya

Penempatan di proyek induk tetap pada posisinya ketika proyek anak diperbarui. Putar setelah pembaruan dan periksa bagian awal serta akhir. Miks anak yang lebih pendek akan diberi keheningan hingga rentang publikasi awal.

## Batasan dan pemulihan

Durasi dan tata letak kanal yang dipublikasikan tetap; sisipkan penempatan lain untuk rentang berbeda. Berkas induk portabel menyertakan audio yang terpasang, tetapi bukan proyek anak yang dapat diedit. Pindahkan proyek anak secara terpisah dan gunakan **Relink to selected project**. Tautan siklik ditolak.
