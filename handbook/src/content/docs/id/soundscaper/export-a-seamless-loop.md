---
title: "Ekspor loop dengan ekor efeknya"
description: "Lipat ekor reverb atau delay ke awal berkas audio yang berulang."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"id"} -->

Lipat ekor reverb atau delay ke awal berkas audio yang berulang.

## Sebelum memulai

Siapkan rentang loop yang tepat dengan pemrosesan yang diinginkan. Gunakan format tanpa kehilangan seperti WAV untuk memeriksa sambungan. Jaga tingkat pemutaran dan ekspor biasa tetap di bawah clipping.

## Langkah-langkah

1. Pilih rentang waktu yang harus berulang dan buka **Berkas > Ekspor audio**.
2. Pilih rentang terpilih serta format, laju sampel, dan tata letak kanal yang sesuai.
3. Aktifkan **Render as loop** di pengaturan ekspor. Ekspor berkas tersebut.
4. Impor hasilnya ke proyek pengujian dan dengarkan beberapa pengulangan, terutama pada batasnya.

## Periksa hasilnya

Berkas ekspor mempertahankan durasi loop yang dipilih sementara ekor hasil render melipat ke awal. Dengarkan bunyi klik, lonjakan tingkat, dan transisi reverb yang mulus.

## Batasan dan pemulihan

Pelipatan ekor tidak dapat memperbaiki potongan musik yang tidak sesuai atau bentuk gelombang kering yang terputus. Fitur ini berbeda dari **Sertakan ekor efek hingga 10 detik**, yang memperpanjang ekspor biasa. Ekor yang dijumlahkan dapat menaikkan puncak; kurangi tingkat atau gunakan pembatas puncak sejati opsional di Limiter, lalu periksa berkas akhir. Format lossy dapat menambahkan jeda atau mengubah puncak, jadi verifikasi juga format tujuan yang sebenarnya.
