---
title: "Reproduzir MIDI por um instrumento"
description: "Escolha um sintetizador para as notas MIDI e mantenha a execução editável."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"pt-BR"} -->

Escolha um sintetizador para as notas MIDI e mantenha a execução editável.

## Antes de começar

Abra ou importe MIDI, ou crie uma nova faixa no Soundscaper. As opções de reprodução integradas variam em relação aos instrumentos nativos opcionais. Instrumentos de plug-in nativo exigem o aplicativo para desktop e o plug-in correspondente ativado.

## Etapas

1. Escolha **Faixas > Adicionar nova faixa > MIDI track (beta)** se precisar de uma faixa.
2. Abra **Janela > Piano roll (beta)**. Adicione notas ou selecione material MIDI existente.
3. Escolha **Instrument**. Para um instrumento nativo, abra **Instrument settings** para ajustar o som e salvar um preset.
4. Inicie a reprodução, confira as notas e a sustentação; em seguida, salve o projeto e abra-o novamente.

## Verifique o resultado

Você deve ouvir o instrumento selecionado enquanto as notas permanecem editáveis no piano roll. As configurações do instrumento e os presets devem retornar ao reabrir o projeto quando o plug-in necessário estiver instalado.

## Limites e recuperação

Instrumentos nativos são oferecidos em faixas MIDI, não em faixas de áudio comuns. Um preset salvo não inclui o binário do plug-in nem suas bibliotecas externas. Instrumentos incluídos vêm ativados por padrão nos pacotes de desktop compatíveis; outros podem exigir o [Plugin Manager](/soundscaper/use-desktop-plugins/). Confira a reprodução e a exportação no computador de destino antes de confiar no mesmo timbre.
