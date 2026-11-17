---
title: "Temukan efek yang membebani CPU saat pemutaran"
description: "Bandingkan biaya efek waktu nyata sebelum memutuskan pemrosesan mana yang perlu disederhanakan."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"id"} -->

Bandingkan biaya efek waktu nyata sebelum memutuskan pemrosesan mana yang perlu disederhanakan.

## Sebelum memulai

Gunakan proyek dengan efek waktu nyata dan bagian sibuk yang mewakili. Pengukuran menggambarkan perangkat dan beban kerja ini; hasilnya bukan peringkat plug-in universal.

## Langkah-langkah

1. Buka **Bantuan > CPU profiling**.
2. Mulai atau mulai ulang pemutaran setelah membuka panel agar setiap efek waktu nyata dapat diukur.
3. Amati beberapa pembaruan. Bandingkan baris efek dengan baris editor dasar; nonaktifkan efek yang mahal dan putar bagian yang sama lagi.
4. Tutup panel setelah selesai dan pulihkan pemrosesan yang ingin dipertahankan.

## Periksa hasilnya

Penggunaan CPU dapat melampaui kapasitas satu inti: 100% berarti satu inti CPU terpakai penuh. Bandingkan persentase CPU dengan persentase waktu pemrosesan yang berlalu. Tanda pisah berarti pengukuran tidak tersedia, bukan biayanya nol.

## Batasan dan pemulihan

Waktu pemrosesan yang berlalu mencakup keterlambatan penjadwalan. Penggunaan GPU dan proses pembantu eksternal tidak disertakan, dan pembuatan profil sendiri menambah beban. Efek yang dinonaktifkan ditandai terpisah. Buka **Opsi lainnya > Auto-idle** pada header efek agar prosesor yang sesuai dapat tidur saat hening. Nonaktifkan untuk efek yang memerlukan pengaturan waktu berkelanjutan. Lihat [pemrosesan lokal](/help/local-processing/) untuk pengaturan terkait. Selalu putar bagian yang sama saat membandingkan perubahan.
