---
title: "Converter notas gravadas em MIDI editável"
description: "Analise uma gravação musical com o Basic Pitch e mantenha notas editáveis junto ao áudio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"pt-PT"} -->

Analise uma gravação musical com o Basic Pitch e mantenha notas editáveis junto ao áudio.

## Antes de começar

Utilize o Soundscaper para computador com o modelo Basic Pitch publicado e o runtime correspondente instalados. Comece por um trecho musical curto com notas nítidas. Mantenha o áudio como referência de audição.

## Passos

1. Seleccione o trecho musical e abra **Ferramentas > Processamento Local Avançado**.
2. Defina **Operação** como **Audio to MIDI (Basic Pitch)**. Confirme o consentimento necessário para o processamento local e escolha **Analisar**.
3. Escolha **Rever resultado**, inspeccione as notas detectadas e seleccione **Aceitar proposta** quando estiver pronto.
4. Abra **Janela > Piano roll (beta)**, seleccione o novo material MIDI e corrija as notas, a temporização e as durações.

## Verificar o resultado

Aparece uma nova faixa MIDI junto ao áudio original. Escolha um instrumento e ouça-o em conjunto com a gravação. **Desfazer** remove a proposta aceite sem eliminar o áudio de origem.

## Limites e recuperação

As notas detectadas são estimativas, sobretudo em misturas densas ou gravações com ruído. O MIDI regista notas, não o timbre original. Utilize [instrumentos MIDI](/soundscaper/play-midi-instruments/) para a reprodução e **Ficheiro > Exportar outro > Export MIDI (beta)** para partilhar as notas. Os destinatários continuam a precisar de um instrumento capaz de reproduzir o som pretendido.
