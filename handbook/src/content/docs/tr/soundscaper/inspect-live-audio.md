---
title: "Çalarken sesi inceleyin"
description: "Analysis panelini kullanarak canlı spektrumu, ses yüksekliğini, stereo denetimlerini ve ACX ses raporunu görün."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"tr"} -->

Analysis panelini kullanarak canlı spektrumu, ses yüksekliğini, stereo denetimlerini ve ACX ses raporunu görün.

## Başlamadan önce

Ses içeren bir proje açın. Çalmayı mı yoksa seçili bir aralığı mı inceleyeceğinize karar verin: zaman seçimi spektrumu seçim analizine geçirebilir.

## Adımlar

1. **İncele > Analiz** menüsünü açın. **Spectrum**, spektrogram, ses yüksekliği veya korelasyon gibi gereken bölümleri genişletin.
2. Zaman seçimini temizleyip canlı görünüm için çalmayı başlatın. Rakip frekans bantlarını bulmak için spektrumdaki parça katmanlarını karşılaştırın.
3. Çalmayı durdurup bir bölüm seçerek spektrumunu çalma olmadan inceleyin.
4. Sesli kitap denetiminde **ACX compliance** bölümünü genişletip **Check audio** seçin. Sonuç tablosunu okuyun; JSON raporu için **Dışa aktarma** kullanın.

## Sonucu kontrol edin

Canlı göstergeler çalmaya tepki verir. ACX raporu yalnızca bir ölçüm göstermek yerine ses denetimlerinin her biri için geçti veya kaldı sonucunu listeler. Başarısız düzeyleri veya biçim ayarlarını düzeltip tekrar denetleyin.

## Sınırlar ve kurtarma

Spektrum enerji gösterir; miksin iyi duyulup duyulmadığını göstermez. Korelasyon ve ses yüksekliği bağlam ve dinleme gerektirir. ACX denetimleri bir yayımlama hizmetinin kabulünü garanti etmez ve her editoryal gereksinimi kontrol etmez. ACX bölümünü daraltmak gösterilen denetimi temizler; gerektiğinde yeniden çalıştırın. Görüntüleme işini azaltmak için gereksiz analiz bölümlerini kapatın.
