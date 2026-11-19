---
title: "Bir ses kaydının tonunu eşleştirin"
description: "Tonal bir referansı öğrenip Match EQ ile başka bir kaydı ona yaklaştırın."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"tr"} -->

Tonal bir referansı öğrenip Match EQ ile başka bir kaydı ona yaklaştırın.

## Başlamadan önce

Duyulabilir, tüm frekansları içeren ve en az çeyrek saniye uzunluğunda bir referans seçin; tercihen aynı kişinin iyi kaydedilmiş sesi olsun. Hedef kaydı hazırlayın. Bu özellik hem tarayıcıda hem masaüstünde yerel işlemeyi kullanır.

## Adımlar

1. Referansı seçip **Etki > EQ ve filtreler > Match EQ** bölümünü açın. **Learn reference from selection** seçin.
2. Bu ses profilini yeniden kullanmak istiyorsanız öğrenilen referansı bir ön ayar olarak kaydedin. İletişim kutusunu kapatın.
3. Hedefi seçip Match EQ'yu yeniden açın; gerekirse referansı çağırıp **Analyze target** seçin.
4. **Önizleme** ile **Orijinal** ve **Matched (level compensated)** seçeneklerini karşılaştırın. Düzeltmeyi ayarlayın, ardından **Seçime uygula** seçin veya eğriyi düzenlemek için **Edit as Filter Curve EQ** seçin.

## Sonucu kontrol edin

Daha yakın bir tonal denge için benzer ses yüksekliğinde dinleyin. Uygulanan ses, süresini ve kanal sayısını korur. **Geri al** uygulamayı geri alır.

## Sınırlar ve kurtarma

Match EQ kaybolan bant genişliğini geri getiremez; performansı, dinamikleri, oda yankısını veya ses kimliğini eşleştiremez. Referans yakalama, veri yolları ve ana çıkıştan önceki parça efektlerini içerir; hedef parça rafından önce analiz edilir. İstenen referans sesi sonraki işlemeye bağlıysa önce referansı render edin.
