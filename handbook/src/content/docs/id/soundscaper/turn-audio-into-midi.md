---
title: "Ubah not rekaman menjadi MIDI yang dapat diedit"
description: "Analisis rekaman musik dengan Basic Pitch dan pertahankan not yang dapat diedit berdampingan dengan audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"id"} -->

Analisis rekaman musik dengan Basic Pitch dan pertahankan not yang dapat diedit berdampingan dengan audio.

## Sebelum memulai

Gunakan Soundscaper desktop dengan model Basic Pitch terbitan dan runtime yang cocok sudah terpasang. Mulai dari pilihan musik singkat dengan nada yang jelas. Pertahankan audio sebagai referensi untuk didengarkan.

## Langkah-langkah

1. Pilih audio musik dan buka **Alat > Pemrosesan Lokal Lanjutan**.
2. Atur **Operasi** ke **Audio to MIDI (Basic Pitch)**. Konfirmasikan persetujuan pemrosesan lokal yang diminta dan pilih **Analisis**.
3. Pilih **Tinjau hasil**, periksa not yang terdeteksi, lalu pilih **Terima proposal** bila sudah siap.
4. Buka **Jendela > Piano roll (beta)**, pilih materi MIDI baru, lalu koreksi nada, waktu, dan panjang not.

## Periksa hasilnya

Trek MIDI baru akan muncul berdampingan dengan audio asli. Pilih instrumen dan dengarkan bersama rekamannya. **Urungkan** menghapus usulan yang diterima tanpa menghapus audio sumber.

## Batasan dan pemulihan

Not yang terdeteksi adalah perkiraan, terutama dalam miks padat atau rekaman bising. MIDI merekam not, bukan timbre asli. Gunakan [instrumen MIDI](/soundscaper/play-midi-instruments/) untuk pemutaran dan **Berkas > Ekspor lainnya > Export MIDI (beta)** untuk membagikan not. Penerima tetap memerlukan instrumen yang dapat menghasilkan suara yang dimaksud.
