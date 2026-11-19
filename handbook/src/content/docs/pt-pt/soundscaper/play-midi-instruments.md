---
title: "Reproduzir MIDI através de um instrumento"
description: "Escolha um sintetizador para notas MIDI e mantenha a execução editável."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"pt-PT"} -->

Escolha um sintetizador para notas MIDI e mantenha a execução editável.

## Antes de começar

Abra ou importe MIDI, ou crie uma nova faixa no Soundscaper. As opções de reprodução integradas variam em relação aos instrumentos nativos opcionais. Os instrumentos de plug-ins nativos requerem a aplicação para computador e o plug-in correspondente activado.

## Passos

1. Se precisar de uma faixa, escolha **Faixas > Adicionar nova faixa > MIDI track (beta)**.
2. Abra **Janela > Piano roll (beta)**. Adicione notas ou seleccione material MIDI existente.
3. Escolha **Instrument**. Para um instrumento nativo, abra **Instrument settings** para ajustar o som e guardar uma predefinição.
4. Inicie a reprodução, verifique as notas e a sustentação, guarde o projecto e volte a abri-lo.

## Verificar o resultado

Deverá ouvir o instrumento seleccionado enquanto as notas continuam editáveis no piano roll. As definições do instrumento e as predefinições deverão reaparecer ao reabrir o projecto, desde que o plug-in necessário esteja instalado.

## Limites e recuperação

Os instrumentos nativos são disponibilizados em faixas MIDI, não em faixas de áudio comuns. Uma predefinição guardada não inclui o ficheiro binário do plug-in nem as bibliotecas externas. Os instrumentos incluídos estão activados por predefinição nos pacotes para computador suportados; outros podem exigir o [Plugin Manager](/soundscaper/use-desktop-plugins/). Verifique a reprodução e a exportação no computador de destino antes de contar com o mesmo timbre.
