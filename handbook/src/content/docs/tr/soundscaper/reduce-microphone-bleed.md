---
title: "Diyalog mikrofonları arasındaki sızıntıyı azaltın"
description: "Etkin olmayan mikrofonlardaki ilişkili sızıntıyı kısmak için düzenlenebilir gain zarfları oluşturun."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5c9e85ea0bae3f0c6489f0b5a3235c11e843612c88fa8c2076a4c00e82937752","targetLocale":"tr"} -->

Etkin olmayan mikrofonlardaki ilişkili sızıntıyı kısmak için düzenlenebilir gain zarfları oluşturun.

## Başlamadan önce

Zamanı hizalanmış iki ila sekiz diyalog parçası kullanın. İdeal olarak kişi başına bir mikrofon olsun ve kayıt gain'leri karşılaştırılabilir düzeyde olsun. Seçilen her parçada sesi bulunan pozitif bir zaman aralığı seçin. Bu parçaların kilidini açıp donmalarını kaldırın.

## Adımlar

1. Mikrofon parçalarını ve işlenecek bölümü seçin.
2. **Etki > Gürültü giderme ve onarım > Automatic microphone-bleed reduction** bölümünü açın.
3. Varsayılan ayarlarla başlayıp **Create gain envelopes** seçin.
4. Özellikle söz kesmeleri ve üst üste konuşmalar sırasında bölümü oynatın. Oluşturulan noktalar istenen konuşmayı kısıyorsa **Klip kazancı** ile ayarlayın.

## Sonucu kontrol edin

Gain noktaları sızıntıyı azaltırken özgün kaynaklar ve klip konumları korunur. Her konuşmacının girişlerini ve seçim sınırlarını kontrol edin. **Geri al** işlemi kaldırır; **Yinele** yeniden uygular.

## Sınırlar ve kurtarma

Bu özellik kayıtları hizalamaz veya etkin bir mikrofonun içindeki sesleri ayırmaz. Büyük gain farkları, yankı ve güçlü sızıntının altındaki kısık konuşmalar hatalara yol açabilir. Farklı ayarlar denemek için ilk uygulamayı geri alın; yeniden uygulama zayıflatmayı biriktirir. Spektral seçimler, kilitli parçalar ve dondurulmuş parçalar işlenemez.
