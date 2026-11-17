---
title: "악기로 MIDI 재생"
description: "MIDI 음표를 위한 신시사이저를 선택하고 편집 가능한 연주를 보존합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"ko"} -->

MIDI 음표를 위한 신시사이저를 선택하고 편집 가능한 연주를 보존합니다.

## 시작하기 전에

MIDI를 열거나 가져오거나 Soundscaper에서 새 트랙을 만듭니다. 내장 재생 옵션과 선택형 네이티브 악기는 서로 다릅니다. 네이티브 플러그인 악기는 데스크톱 앱과 일치하는 활성 플러그인이 필요합니다.

## 단계

1. 트랙이 필요하면 **트랙 메뉴 > 새 트랙 추가 > MIDI track (beta)**를 선택합니다.
2. **창 > Piano roll (beta)**를 엽니다. 음표를 추가하거나 기존 MIDI 자료를 선택합니다.
3. **Instrument**를 선택합니다. 네이티브 악기라면 **Instrument settings**를 열어 소리를 조정하고 프리셋을 저장합니다.
4. 재생을 시작하고 음표와 서스테인을 확인한 다음 프로젝트를 저장하고 다시 엽니다.

## 결과 확인

선택한 악기의 소리가 들리며 피아노 롤의 음표는 편집할 수 있어야 합니다. 필요한 플러그인이 설치되어 있다면 다시 열었을 때 악기 설정과 프리셋이 복원됩니다.

## 제한 및 복구

네이티브 악기는 일반 오디오 트랙이 아니라 MIDI 트랙에 제공됩니다. 저장한 프리셋에는 플러그인 바이너리나 외부 라이브러리가 포함되지 않습니다. 지원되는 데스크톱 패키지에서는 번들 악기가 기본으로 활성화됩니다. 그 밖의 악기에는 [Plugin Manager](/soundscaper/use-desktop-plugins/)가 필요할 수 있습니다. 같은 음색에 의존하기 전에 대상 컴퓨터에서 재생과 내보내기를 확인합니다.
