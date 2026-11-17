---
title: "Usar plug-ins de áudio no desktop"
description: "Encontre, ative e ouça efeitos e instrumentos nativos no Soundscaper para desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"pt-BR"} -->

Encontre, ative e ouça efeitos e instrumentos nativos no Soundscaper para desktop.

## Antes de começar

Instale uma build do plug-in compatível com seu sistema operacional e com o formato de host aceito. Plug-ins de desktop incluídos ficam disponíveis por padrão nos pacotes compatíveis; outros plug-ins ainda precisam ser detectados e podem exigir permissão.

## Etapas

1. Abra **Efeito > Gerenciador de Plugins**. Pesquise na lista e use **Digitalização e configurações** para configurar a detecção.
2. Selecione o plug-in e confira a versão, a permissão e os controles de recuperação. Ative-o quando for apropriado.
3. Adicione um efeito em **Efeito > Efeitos de Plugins de Áudio** ou em um rack de tempo real. Selecione instrumentos nativos nos controles de instrumento da faixa MIDI.
4. Ouça a reprodução, salve um preset se for útil e salve o projeto.

## Verifique o resultado

O plug-in desejado deve processar o som e recarregar as configurações salvas quando o mesmo binário compatível estiver disponível. Ignore-o para comparar e confira a exportação antes da entrega.

## Limites e recuperação

Os pacotes Windows oferecem suporte aos caminhos mantidos de bridge VST2, incluindo plug-ins de 32 bits compatíveis. No Linux, é possível usar Windows VST3 com uma configuração instalada e configurada de yabridge/Wine; isso não instala nem licencia plug-ins de terceiros. Presets não incluem os binários. Se um plug-in falhar, use os controles de recuperação do Plugin Manager e experimente uma versão compatível antes de retomar o trabalho.
