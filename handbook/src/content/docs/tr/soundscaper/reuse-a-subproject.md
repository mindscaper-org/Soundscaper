---
title: "Kayıtlı projeyi bağlantılı ses olarak yeniden kullanın"
description: "Kayıtlı bir projeyi başka bir düzene ekleyin ve sonraki düzenlemelerini izleyin."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"tr"} -->

Kayıtlı bir projeyi başka bir düzene ekleyin ve sonraki düzenlemelerini izleyin.

## Başlamadan önce

Alt Soundscaper projesini aynı yerel proje kitaplığına kaydedin. Önce miksini tamamlayın. Arka plan alt proje işleyicisini kullanmadan önce etkin yerel eklenti işlemesini sese render edip işleyin.

## Adımlar

1. Üst projeyi açıp **Dosya > Subprojects** seçeneğini seçin.
2. **Project to insert or relink** altında alt projeyi seçip **Insert subproject** seçin. Yayımlanmış miks yeni bir parçada görünür.
3. **Linked subprojects** altındaki bağlantıyı seçip alt projeyi düzenlemek için **Open subproject** seçin. Kaydedin ve güncellenen sesi dinlemek için üst projeye dönün.
4. Bu sürümü korumak için **Pin current audio**, alt projeyi izlemeyi bırakmak için **Make independent audio** seçin.

## Sonucu kontrol edin

Alt proje güncellendiğinde üst projedeki konum sabit kalır. Yenilemeden sonra oynatıp başlangıç ve bitişi kontrol edin. Daha kısa alt miksin ilk yayımlanan aralığı sessizlikle doldurulur.

## Sınırlar ve kurtarma

Yayımlanan süre ve kanal düzeni sabittir; farklı bir aralık için başka bir yerleştirme ekleyin. Taşınabilir üst dosyaya kurulmuş ses dahildir ancak düzenlenebilir alt proje dahil değildir. Alt projeyi ayrı aktarın ve **Relink to selected project** kullanın. Döngüsel bağlantılar reddedilir.
