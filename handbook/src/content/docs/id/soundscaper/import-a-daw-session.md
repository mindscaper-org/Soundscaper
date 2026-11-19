---
title: "Impor sesi audio dari editor lain"
description: "Impor edit audio yang didukung, sambungkan kembali medianya, dan tinjau batas konversinya."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"id"} -->

Impor edit audio yang didukung, sambungkan kembali medianya, dan tinjau batas konversinya.

## Sebelum memulai

Salin sesi dan audionya ke folder yang dapat diakses. Impor sesi audio native yang didukung meliputi REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, sesi SoundCraft, serta Audition `.sesx` atau `.ses` versi lama. Simpan proyek asli.

## Langkah-langkah

1. Pilih **Berkas > Terbuka** atau **Berkas > Impor**, atau seret sesi ke ruang kerja.
2. Di browser, pilih audio pendamping bersama sesi. Di desktop, berikan akses ke folder media saat diminta.
3. Buka **Berkas > Laporan Pengiriman**. Baca daftar yang dihilangkan dan dikonversi, lalu tautkan kembali media offline bila diperlukan.
4. Dengarkan edit dan fade yang mewakili, periksa urutan trek dan waktunya, lalu simpan proyek Scape baru.

## Periksa hasilnya

Potongan yang diimpor seharusnya sejajar dengan audio sumber yang dapat diakses. Bandingkan hasilnya dengan miks referensi dari editor asli, terutama bila pemrosesan, perutean, atau otomatisasi berpengaruh.

## Batasan dan pemulihan

Impor native mengonversi edit audio; hasilnya tidak menjamin miks identik. Detail yang didukung berbeda menurut format; plug-in dari sesi sumber tidak dijalankan. REAPER menggunakan take audio aktif dan menghilangkan pengeditan take alternatif, MIDI, perutean, serta plug-in. Untuk bertukar kembali dengan DAW lain, gunakan format pertukaran yang didukung seperti AES31 ADL atau DAWproject alih-alih mengharapkan penulis sesi native.
