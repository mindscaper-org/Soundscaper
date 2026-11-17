---
title: "녹음한 음을 편집 가능한 MIDI로 변환"
description: "Basic Pitch로 음악 녹음을 분석하고 오디오와 함께 편집 가능한 음표를 유지합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"181c19e5cd65ab9072edb6fd6211bd2006656197182553009771a0e0f4262552","targetLocale":"ko"} -->

Basic Pitch로 음악 녹음을 분석하고 오디오와 함께 편집 가능한 음표를 유지합니다.

## 시작하기 전에

Soundscaper 데스크톱에서 공개된 Basic Pitch 모델과 호환 런타임을 설치합니다. 음높이가 분명한 짧은 음악 구간부터 시작하고 오디오는 청취 참고용으로 보존합니다.

## 단계

1. 음악 오디오를 선택하고 **도구 > 고급 로컬 처리**을 엽니다.
2. **작업**을 **Audio to MIDI (Basic Pitch)**로 설정합니다. 필요한 로컬 처리 동의를 확인하고 **분석**를 선택합니다.
3. **결과 검토**를 선택해 감지된 음표를 살펴보고 준비되면 **제안 수용**을 선택합니다.
4. **창 > Piano roll (beta)**를 열고 새 MIDI 자료를 선택해 음높이, 타이밍, 음표 길이를 수정합니다.

## 결과 확인

원본 오디오 옆에 새 MIDI 트랙이 나타납니다. 악기를 선택하고 녹음과 함께 들어봅니다. **되돌리기**는 원본 오디오를 삭제하지 않고 수락된 제안을 제거합니다.

## 제한 및 복구

감지된 음표는 추정치이며 밀도가 높은 믹스나 노이즈가 있는 녹음에서는 특히 부정확할 수 있습니다. MIDI는 원래 음색이 아니라 음표를 담습니다. 재생에는 [MIDI 악기](/soundscaper/play-midi-instruments/)를 사용하고, 공유하려면 **파일 > 기타 내보내기 > Export MIDI (beta)**를 사용합니다. 받는 쪽에도 의도한 소리를 낼 수 있는 악기가 필요합니다.
