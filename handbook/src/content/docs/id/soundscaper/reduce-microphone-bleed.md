---
title: "Kurangi kebocoran antar mikrofon dialog"
description: "Buat envelope gain yang dapat diedit untuk mengecilkan kebocoran berkorelasi pada mikrofon yang tidak aktif."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"id"} -->

Buat envelope gain yang dapat diedit untuk mengecilkan kebocoran berkorelasi pada mikrofon yang tidak aktif.

## Sebelum memulai

Gunakan dua hingga delapan trek dialog yang selaras waktunya, idealnya satu mikrofon per orang dengan gain rekaman yang sebanding. Pilih rentang waktu positif yang berisi audio di setiap trek terpilih. Buka kunci dan cairkan trek tersebut.

## Langkah-langkah

1. Pilih trek mikrofon dan bagian yang akan diproses.
2. Buka **Efek > Penghapusan dan perbaikan derau > Automatic microphone-bleed reduction**.
3. Mulai dengan pengaturan bawaan, lalu pilih **Create gain envelopes**.
4. Putar bagian tersebut, khususnya saat ada interupsi dan percakapan yang bertumpang-tindih. Gunakan **Penguatan klip** untuk menyesuaikan titik yang dihasilkan dan mengecilkan ucapan yang seharusnya terdengar.

## Periksa hasilnya

Titik gain mengurangi kebocoran sementara sumber asli dan posisi klip tetap tersedia. Periksa setiap awal giliran bicara serta batas pilihan. **Urungkan** menghapus operasi; **Ulangi** menerapkannya kembali.

## Batasan dan pemulihan

Fitur ini tidak menyelaraskan rekaman atau memisahkan suara di dalam mikrofon aktif. Perbedaan gain yang besar, gema, dan ucapan pelan di bawah kebocoran keras dapat menyebabkan kekeliruan. Untuk mencoba pengaturan lain, batalkan penerapan pertama: penerapan ulang akan menumpuk pengurangan gain. Pilihan spektral, trek terkunci, dan trek beku tidak dapat diproses.
