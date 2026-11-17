---
title: "Utilizar plug-ins de áudio na versão para computador"
description: "Localize, active e ouça efeitos e instrumentos nativos no Soundscaper para computador."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"pt-PT"} -->

Localize, active e ouça efeitos e instrumentos nativos no Soundscaper para computador.

## Antes de começar

Instale uma versão do plug-in compatível com o sistema operativo e o formato de host suportado. Os plug-ins para computador incluídos estão disponíveis por predefinição nos pacotes compatíveis; os plug-ins adicionais ainda precisam de ser detectados e podem exigir autorização.

## Passos

1. Abra **Efeito > Gestor de Plugins**. Pesquise a lista e utilize **Digitalização e Definições** para configurar a detecção.
2. Seleccione o plug-in e consulte a versão, as permissões e os controlos de recuperação. Active-o quando for adequado.
3. Adicione um efeito através de **Efeito > Efeitos de plugins de áudio** ou de um rack em tempo real. Seleccione instrumentos nativos nos controlos de instrumento da faixa MIDI.
4. Ouça a reprodução, guarde uma predefinição se for útil e guarde o projecto.

## Verificar o resultado

O plug-in pretendido deverá processar o som e recarregar as definições guardadas quando estiver disponível o mesmo binário compatível. Ignore-o para comparar e verifique a exportação antes da entrega.

## Limites e recuperação

Os pacotes Windows suportam os percursos de bridge VST2 mantidos, incluindo plug-ins de 32 bits suportados. O Linux pode utilizar Windows VST3 através de uma configuração yabridge/Wine instalada e configurada; esta não instala nem licencia plug-ins de terceiros. As predefinições não incluem binários. Se um plug-in falhar, utilize os controlos de recuperação do Plugin Manager e experimente uma versão compatível antes de retomar o trabalho.
