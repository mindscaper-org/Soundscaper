---
title: "Efekt kuyruklarıyla bir döngüyü dışa aktarın"
description: "Reverb veya delay kuyruğunu yinelenen bir ses dosyasının başına sarın."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"tr"} -->

Reverb veya delay kuyruğunu yinelenen bir ses dosyasının başına sarın.

## Başlamadan önce

İstenen işlemenin bulunduğu kesin bir döngü aralığı hazırlayın. Birleşim yerini kontrol etmek için WAV gibi kayıpsız biçim kullanın. Normal çalma ve dışa aktarma düzeylerini kırpılmanın altında tutun.

## Adımlar

1. Yinelenmesi gereken zaman aralığını seçip **Dosya > Sesi dışa aktar** bölümünü açın.
2. Seçili aralığı ve uygun biçim, örnekleme hızı, kanal düzenini belirleyin.
3. Dışa aktarma ayarlarında **Render as loop** seçeneğini etkinleştirip dosyayı dışa aktarın.
4. Sonucu bir test projesine alın ve özellikle sınırda olmak üzere birkaç kez dinleyin.

## Sonucu kontrol edin

Dışa aktarılan dosya seçilen döngü süresini korur; render edilen kuyruk başa sarılır. Tıklama, düzey artışı ve yumuşak bir reverb geçişi olup olmadığını dinleyin.

## Sınırlar ve kurtarma

Kuyruğu başa sarmak uygun olmayan müzik kesimini veya kesintili kuru dalga biçimini düzeltemez. Normal dışa aktarmayı uzatan **10 saniyeye kadar etki kuyruklarını dahil et** seçeneğinden farklıdır. Toplanan kuyruklar tepe düzeylerini artırabilir; düzeyi azaltın veya Limiter'ın isteğe bağlı true peak sınırlamasını kullanıp teslim dosyasını kontrol edin. Kayıplı biçimler dolgu ekleyebilir veya tepe düzeylerini değiştirebilir; gerçek hedef biçimini de doğrulayın.
