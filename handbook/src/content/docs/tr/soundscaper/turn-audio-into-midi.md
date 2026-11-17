---
title: "Kaydedilmiş notaları düzenlenebilir MIDI'ye dönüştürün"
description: "Basic Pitch ile müzik kaydını analiz edin ve düzenlenebilir notaları sesin yanında tutun."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"tr"} -->

Basic Pitch ile müzik kaydını analiz edin ve düzenlenebilir notaları sesin yanında tutun.

## Başlamadan önce

Yayımlanmış Basic Pitch modeli ve uyumlu çalışma zamanı kurulu Soundscaper masaüstünü kullanın. Net perdeli kısa bir müzik seçimiyle başlayın. Sesi dinleme referansı olarak saklayın.

## Adımlar

1. Müzik sesini seçip **Araçlar > Gelişmiş Yerel İşleme** bölümünü açın.
2. **İşlem** değerini **Audio to MIDI (Basic Pitch)** olarak ayarlayın. Gerekli yerel işlem iznini onaylayıp **İncele** seçin.
3. **Sonucu incele** seçeneğini seçip algılanan notaları inceleyin, hazır olduğunuzda **Öneriyi kabul et** seçin.
4. **Pencere > Piano roll (beta)** bölümünü açın, yeni MIDI malzemesini seçip perdeyi, zamanlamayı ve nota uzunluğunu düzeltin.

## Sonucu kontrol edin

Özgün sesin yanında yeni bir MIDI parçası görünür. Bir enstrüman seçip kayda karşı dinleyin. **Geri al**, kaynak sesi silmeden kabul edilen öneriyi kaldırır.

## Sınırlar ve kurtarma

Algılanan notalar tahmindir; yoğun mikslerde veya gürültülü kayıtlarda özellikle hatalı olabilir. MIDI özgün tınıyı değil notaları içerir. Çalma için [MIDI enstrümanlarını](/soundscaper/play-midi-instruments/) kullanın, notaları paylaşmak için **Dosya > Diğer dışa aktarımlar > Export MIDI (beta)** seçin. Alıcının da amaçlanan sesi üretecek enstrümana ihtiyacı vardır.
