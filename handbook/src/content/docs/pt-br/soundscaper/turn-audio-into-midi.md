---
title: "Transformar notas gravadas em MIDI editável"
description: "Analise uma gravação musical com o Basic Pitch e mantenha notas editáveis junto ao áudio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"pt-BR"} -->

Analise uma gravação musical com o Basic Pitch e mantenha notas editáveis junto ao áudio.

## Antes de começar

Use o Soundscaper para desktop com o modelo Basic Pitch publicado e o runtime correspondente instalados. Comece com uma seleção musical curta e de notas claras. Mantenha o áudio como referência de escuta.

## Etapas

1. Selecione o trecho musical e abra **Ferramentas > Processamento local avançado**.
2. Defina **Operação** como **Audio to MIDI (Basic Pitch)**. Confirme o consentimento exigido para processamento local e escolha **Analisar**.
3. Escolha **Revisar resultado**, inspecione as notas detectadas e escolha **Aceitar proposta** quando estiver pronto.
4. Abra **Janela > Piano roll (beta)**, selecione o novo material MIDI e corrija as alturas, o tempo e a duração das notas.

## Verifique o resultado

Uma nova faixa MIDI aparece ao lado do áudio original. Escolha um instrumento e ouça-o junto com a gravação. **Desfazer** remove a proposta aceita sem excluir o áudio de origem.

## Limites e recuperação

As notas detectadas são estimativas, principalmente em mixagens densas ou gravações ruidosas. O MIDI registra as notas, não o timbre original. Use [instrumentos MIDI](/soundscaper/play-midi-instruments/) para reprodução e **Arquivo > Outras exportações > Export MIDI (beta)** para compartilhar as notas. Os destinatários ainda precisam de um instrumento que reproduza o som pretendido.
