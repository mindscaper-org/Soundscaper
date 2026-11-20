---
title: "Usar plug-ins de áudio no desktop"
description: "Encontre, ative e ouça efeitos e instrumentos nativos no Soundscaper para desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"pt-BR"} -->

Encontre, ative e ouça efeitos e instrumentos nativos no Soundscaper para desktop.

## Antes de começar

Instale uma build do plug-in compatível com seu sistema operacional e com o formato de host aceito. Plug-ins de desktop incluídos ficam disponíveis por padrão nos pacotes compatíveis; outros plug-ins ainda precisam ser detectados e podem exigir permissão.

## Etapas

1. Abra **Efeito > Gerenciador de Plugins**. Pesquise na lista e use **Digitalização e configurações** para configurar a detecção.
2. Selecione o plug-in e confira a versão, a permissão e os controles de recuperação. Ative-o quando for apropriado.
3. Adicione um efeito em **Efeito > Efeitos de Plugins de Áudio** ou em um rack de tempo real. Selecione instrumentos nativos nos controles de instrumento da faixa MIDI.
4. Ouça a reprodução, salve um preset se for útil e salve o projeto.

## Tocar com um amplificador de guitarra

Adicione o **OrbitAmp** em **Efeito > Efeitos de Plugins de Áudio** ou no rack de efeitos em tempo real de uma faixa. Abra o editor do plug-in e escolha um amplificador na seção **AMP** e um gabinete na seção **CAB**. O pacote para desktop inclui os sons de fábrica.

## Verifique o resultado

O plug-in desejado deve processar o som e recarregar as configurações salvas quando o mesmo binário compatível estiver disponível. Ignore-o para comparar e confira a exportação antes da entrega.

## Limites e recuperação

Os pacotes Windows oferecem suporte aos caminhos mantidos de bridge VST2, incluindo plug-ins de 32 bits compatíveis. No Linux, é possível usar Windows VST3 com uma configuração instalada e configurada de yabridge/Wine; isso não instala nem licencia plug-ins de terceiros. Presets não incluem os binários. Se um plug-in falhar, use os controles de recuperação do Plugin Manager e experimente uma versão compatível antes de retomar o trabalho.
