---
title: "Hoparlörler için ADM programı işleyin"
description: "Oluşturulmuş ADM bed ve nesnelerini EBU EAR kullanarak sıradan hoparlör sesine aktarın."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"tr"} -->

Oluşturulmuş ADM bed ve nesnelerini EBU EAR kullanarak sıradan hoparlör sesine aktarın.

## Başlamadan önce

Metadata editor içindeki ADM sekmesinde bed atamaları ve konumlandırılmış nesneler içeren bir ADM programı oluşturun. Teslim hoparlör düzenini bilin ve gereken kanal sayısını taşıyabilecek kapsayıcıyla codec seçin.

## Adımlar

1. **Dosya > Sesi dışa aktar** bölümünü açın.
2. **Render > EBU EAR speaker rendering** altında stereo, 5.1, 5.1.2, 5.1.4, 7.1 veya 7.1.4 düzenlerinden birini seçin.
3. Çıkış biçimini, kanal sayısını ve düzey ayarlarını kontrol edip dışa aktarın.
4. Teslim raporunu okuyun ve dışa aktarılan dosyayı eşleşen hoparlör düzeninde dinleyin.

## Sonucu kontrol edin

Çıktı, belirtilen kanal sıralamasında render edilmiş hoparlör PCM'i içerir. Bu dışa aktarma seçeneği proje dinlemesini veya özgün ADM düzenlemesini değiştirmez. Kullanılan işleyiciyi ve düzeni rapordan kontrol edin.

## Sınırlar ve kurtarma

EAR hoparlör işleme ile kulaklık işleme birleştirilemez. Bölünmüş çıktılar ve BW64/ADM geçişi bu seçeneği kullanamaz. Render edilen kanallar özgün bed/object ADM üst verisini taşımaz; bu alışveriş için render edilmemiş BW64 kullanın. Hareketli veya yaygın nesneler, HOA, bas yönetimi ve sertifikalı Dolby işleme bu özelliğin kapsamı dışındadır. Normal ses yüksekliği ölçeri en fazla sekiz teslim kanalını destekler.
