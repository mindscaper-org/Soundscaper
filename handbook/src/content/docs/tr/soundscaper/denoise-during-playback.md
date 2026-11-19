---
title: "Çalma sırasında gürültüyü azaltın"
description: "Bir diyalog parçasına gerçek zamanlı yapay zekâ gürültü azaltma efekti ekleyin."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"tr"} -->

Bir diyalog parçasına gerçek zamanlı yapay zekâ gürültü azaltma efekti ekleyin.

## Başlamadan önce

Soundscaper masaüstü sürümünü kullanın. **Araçlar > Model Yöneticisi** bölümünü açıp derlemenizin sunduğu uyumlu gerçek zamanlı gürültü azaltma modeliyle çalışma zamanını yükleyin. Model yükleme açık bir indirme işlemidir; yalnızca tarayıcı bu yerel efekti çalıştıramaz.

## Adımlar

1. Gürültülü diyalog parçasını seçip gerçek zamanlı efekt rafını açın.
2. **Etki ekle** seçip **AI denoising (DPDFNet2)** seçeneğini belirleyin.
3. Çalmayı başlatın ve güç düğmesiyle efekti atlayıp karşılaştırın.
4. Temizlenen parçanın çevresindeki miksi ayarlayın ve teslim etmeden önce dışa aktarımı dinleyin. Rafı korumak için projeyi kaydedin.

## Sonucu kontrol edin

Konuşma anlaşılır kalırken gürültü azalmalıdır. Kısık ünsüzleri, nefesleri ve çalmanın başlangıcını kontrol edin. Ses dalgalanıyor veya konuşma kayboluyorsa efekti atlayıp orijinalle karşılaştırın.

## Sınırlar ve kurtarma

Bu, konuşma gürültüsünü azaltır; genel bir müzik restorasyon efekti değildir. Başka bir bilgisayarda çalmak için uyumlu model ve yerel çalışma zamanı gerekir. Efekt yoksa yüklemeyi ve masaüstü desteğini kontrol edin; incelenmiş bir render sonucu gerekiyorsa [çevrimdışı konuşma restorasyonu](/soundscaper/restore-damaged-speech/) kullanın. Modeli indirmek her kaydın iyileşeceğini göstermez.
