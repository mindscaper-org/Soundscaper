---
title: "다른 편집기의 오디오 세션 가져오기"
description: "지원되는 오디오 편집을 가져오고 미디어를 다시 연결한 뒤 변환 제한을 확인합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"ko"} -->

지원되는 오디오 편집을 가져오고 미디어를 다시 연결한 뒤 변환 제한을 확인합니다.

## 시작하기 전에

세션과 오디오를 액세스 가능한 폴더에 복사합니다. 지원되는 네이티브 오디오 세션 가져오기에는 REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft 세션, Audition `.sesx` 또는 이전 `.ses`가 포함됩니다. 원본 프로젝트를 보존합니다.

## 단계

1. **파일 > 열림** 또는 **파일 > 가져오기**를 선택하거나 세션을 작업 영역에 놓습니다.
2. 브라우저에서는 세션과 함께 제공되는 오디오를 선택합니다. 데스크톱에서는 요청이 있을 때 미디어 폴더 접근을 허용합니다.
3. **파일 > 전달 보고서**를 엽니다. 누락 및 변환 내용을 확인하고 필요한 경우 오프라인 미디어를 다시 연결합니다.
4. 대표적인 편집과 페이드를 들어보고 트랙 순서와 타이밍을 확인한 다음 새 Scape 프로젝트로 저장합니다.

## 결과 확인

가져온 컷이 액세스 가능한 원본 오디오와 맞아야 합니다. 특히 처리, 라우팅 또는 자동화가 중요한 곳은 원래 편집기의 기준 믹스와 비교합니다.

## 제한 및 복구

네이티브 가져오기는 오디오 편집을 변환하는 것이며 믹스가 완전히 같다고 보장하지 않습니다. 지원되는 세부 사항은 형식마다 다르고 원본 세션의 플러그인은 실행되지 않습니다. REAPER는 활성 오디오 테이크를 사용하며 대체 테이크 편집, MIDI, 라우팅, 플러그인은 제외합니다. 다른 DAW와 교환하려면 네이티브 세션 기록을 기대하지 말고 AES31 ADL 또는 DAWproject 같은 지원되는 교환 형식을 사용합니다.
