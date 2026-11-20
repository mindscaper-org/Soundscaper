---
title: "Utilizar plug-ins de áudio na versão para computador"
description: "Localize, active e ouça efeitos e instrumentos nativos no Soundscaper para computador."
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"pt-PT"} -->

Localize, active e ouça efeitos e instrumentos nativos no Soundscaper para computador.

## Antes de começar

Instale uma versão do plug-in compatível com o sistema operativo e o formato de host suportado. Os plug-ins para computador incluídos estão disponíveis por predefinição nos pacotes compatíveis; os plug-ins adicionais ainda precisam de ser detectados e podem exigir autorização.

## Passos

1. Abra **Efeito > Gestor de Plugins**. Pesquise a lista e utilize **Digitalização e Definições** para configurar a detecção.
2. Seleccione o plug-in e consulte a versão, as permissões e os controlos de recuperação. Active-o quando for adequado.
3. Adicione um efeito através de **Efeito > Efeitos de plugins de áudio** ou de um rack em tempo real. Seleccione instrumentos nativos nos controlos de instrumento da faixa MIDI.
4. Ouça a reprodução, guarde uma predefinição se for útil e guarde o projecto.

## Tocar com um amplificador de guitarra

Adicione o **OrbitAmp** em **Efeito > Efeitos de plugins de áudio** ou no rack de efeitos em tempo real de uma faixa. Abra o editor do plug-in e escolha um amplificador na secção **AMP** e uma coluna na secção **CAB**. O pacote para computador inclui os sons de fábrica.

## Verificar o resultado

O plug-in pretendido deverá processar o som e recarregar as definições guardadas quando estiver disponível o mesmo binário compatível. Ignore-o para comparar e verifique a exportação antes da entrega.

## Limites e recuperação

Os pacotes Windows suportam os percursos de bridge VST2 mantidos, incluindo plug-ins de 32 bits suportados. O Linux pode utilizar Windows VST3 através de uma configuração yabridge/Wine instalada e configurada; esta não instala nem licencia plug-ins de terceiros. As predefinições não incluem binários. Se um plug-in falhar, utilize os controlos de recuperação do Plugin Manager e experimente uma versão compatível antes de retomar o trabalho.
