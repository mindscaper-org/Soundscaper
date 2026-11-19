---
title: "Başka bir düzenleyiciden ses oturumu alın"
description: "Desteklenen ses düzenlemelerini içe aktarın, medyayı yeniden bağlayın ve dönüştürme sınırlarını inceleyin."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"tr"} -->

Desteklenen ses düzenlemelerini içe aktarın, medyayı yeniden bağlayın ve dönüştürme sınırlarını inceleyin.

## Başlamadan önce

Oturumu ve sesini erişilebilir bir klasöre kopyalayın. Desteklenen yerel ses oturumu biçimleri REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft oturumları ve Audition `.sesx` veya eski `.ses` dosyalarıdır. Özgün projeyi koruyun.

## Adımlar

1. **Dosya > Açık** ya da **Dosya > İçe aktarma** seçin veya oturumu çalışma alanına bırakın.
2. Tarayıcıda oturumla birlikte gelen sesi seçin. Masaüstünde istendiğinde medya klasörüne erişim izni verin.
3. **Dosya > Teslimat Raporu** bölümünü açın. Atlanan ve dönüştürülen öğeleri okuyun, gerekirse çevrimdışı medyayı yeniden bağlayın.
4. Temsili düzenlemeleri ve fade'leri dinleyin, parça sırasıyla zamanlamayı inceleyin ve yeni bir Scape projesi kaydedin.

## Sonucu kontrol edin

İçe aktarılan kesmeler erişilebilir kaynak sesle hizalanmalıdır. Özellikle işleme, yönlendirme veya otomasyon önemliyse sonucu özgün düzenleyicinin referans miksiyle karşılaştırın.

## Sınırlar ve kurtarma

Yerel içe aktarma ses düzenlemelerini dönüştürür; aynı miksin oluşacağını garanti etmez. Desteklenen ayrıntılar biçime göre değişir ve kaynak oturumdaki eklentiler çalıştırılmaz. REAPER etkin ses take'lerini kullanır; alternatif take düzenlemelerini, MIDI'yi, yönlendirmeyi ve eklentileri atlar. Başka bir DAW ile alışverişte yerel oturum yazıcısı beklemek yerine AES31 ADL veya DAWproject gibi desteklenen değişim biçimlerini kullanın.
