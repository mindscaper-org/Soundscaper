---
title: "Masaüstü ses eklentilerini kullanın"
description: "Soundscaper masaüstünde yerel efektleri ve enstrümanları bulun, etkinleştirin ve dinleyin."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"tr"} -->

Soundscaper masaüstünde yerel efektleri ve enstrümanları bulun, etkinleştirin ve dinleyin.

## Başlamadan önce

İşletim sisteminizle ve desteklenen ana bilgisayar biçimiyle uyumlu bir eklenti derlemesi yükleyin. Desteklenen paketlerde birlikte gelen masaüstü eklentileri varsayılan olarak kullanılabilir; ek eklentileri keşfetmeniz ve gerekirse izin vermeniz gerekir.

## Adımlar

1. **Etki > Plugin Yönetimi** bölümünü açın. Listeyi arayın ve keşif ayarları için **Tarama ve Ayarlar** kullanın.
2. Eklentiyi seçip sürümünü, izinlerini ve kurtarma denetimlerini inceleyin. Uygunsa etkinleştirin.
3. **Etki > Ses Plugin'leri** veya gerçek zamanlı raf üzerinden efekt ekleyin. MIDI parçasının enstrüman denetimlerinden yerel enstrümanları seçin.
4. Çalmayı dinleyin, gerekirse ön ayarı kaydedin ve projeyi kaydedin.

## Gitar amfisiyle çalma

**Etki > Ses Plugin'leri** menüsünden veya bir izin gerçek zamanlı efekt rafından **OrbitAmp**’i ekleyin. Eklenti düzenleyicisini açın ve **AMP** bölümünde bir amfi, **CAB** bölümünde bir hoparlör kabini seçin. Masaüstü paketi fabrika seslerini içerir.

## Sonucu kontrol edin

Uyumlu aynı ikili dosya kullanılabiliyorsa amaçlanan eklenti sesi işlemeli ve kayıtlı ayarlarıyla yeniden yüklenmelidir. Teslimden önce karşılaştırmak için atlayın ve dışa aktarmayı kontrol edin.

## Sınırlar ve kurtarma

Windows paketleri, desteklenen 32 bit eklentiler dahil korunan VST2 köprü yollarını destekler. Linux, yüklenmiş ve yapılandırılmış yabridge/Wine kurulumu üzerinden Windows VST3 kullanabilir; bu, üçüncü taraf eklentileri sizin yerinize yüklemez veya lisanslamaz. Eklenti ön ayarları ikili dosyaları içermez. Eklenti hata verirse Plugin Manager kurtarma denetimlerini kullanıp işe devam etmeden önce uyumlu sürümü deneyin.
