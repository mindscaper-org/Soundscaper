---
title: "Çalma CPU'su kullanan efektleri bulun"
description: "Hangi işlemeyi basitleştireceğinize karar vermeden önce gerçek zamanlı efektlerin maliyetini karşılaştırın."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"06fac5e13d2af31e85494e4a5e5b9fa26ae67584fd3365c795c95d63d93a255d","targetLocale":"tr"} -->

Hangi işlemeyi basitleştireceğinize karar vermeden önce gerçek zamanlı efektlerin maliyetini karşılaştırın.

## Başlamadan önce

Gerçek zamanlı efektler ve temsili yoğun bir bölüm bulunan bir proje kullanın. Ölçümler bu cihaz ve iş yükünü açıklar; eklentiler için evrensel bir sıralama değildir.

## Adımlar

1. **Yardım > CPU profiling** menüsünü açın.
2. Her gerçek zamanlı efektin ölçülmesi için panel açıldıktan sonra çalmayı başlatın veya yeniden başlatın.
3. Birkaç güncellemeyi izleyin. Efekt satırlarını temel düzenleyici satırıyla karşılaştırın; maliyetli bir efekti atlayıp aynı bölümü tekrar çalın.
4. İşiniz bitince paneli kapatıp korumak istediğiniz işlemeyi geri yükleyin.

## Sonucu kontrol edin

CPU kullanımı tek çekirdeğin kapasitesini aşabilir: %100, bir CPU çekirdeğinin tamamen dolu olduğu anlamına gelir. CPU yüzdesiyle geçen işlem süresi yüzdesini karşılaştırın. Tire işareti ölçüm bulunmadığını gösterir; sıfır maliyet demek değildir.

## Sınırlar ve kurtarma

Geçen işlem süresine zamanlama gecikmeleri dahildir. GPU kullanımı ve harici yardımcı işlemler dahil değildir; profil çıkarma işlemi de ek yük getirir. Atlanan efekt ayrı gösterilir. Uygun işlemcinin sessizlik sırasında uyuması için efekt başlığındaki **Diğer seçenekler > Auto-idle** menüsünü açın. Sürekli zamanlama gereken efektlerde bu seçeneği devre dışı bırakın. İlgili ayarlar için [yerel işleme](/help/local-processing/) sayfasına bakın. Değişiklikleri karşılaştırırken daima aynı bölümü yeniden çalın.
