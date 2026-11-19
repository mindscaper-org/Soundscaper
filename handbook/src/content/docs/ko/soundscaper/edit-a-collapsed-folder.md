---
title: "접힌 폴더 안의 트랙 편집"
description: "모든 트랙을 펼치지 않고 접힌 폴더의 중첩 트랙에 걸쳐 구간을 자르거나 삽입합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","targetLocale":"ko"} -->

모든 트랙을 펼치지 않고 접힌 폴더의 중첩 트랙에 걸쳐 구간을 자르거나 삽입합니다.

## 시작하기 전에

트랙의 **트랙 메뉴 > 선택 항목을 새 폴더로 이동**를 사용해 트랙 폴더를 만들거나 기존 폴더 편곡을 엽니다. 함께 이동해야 하는 내용이 들어 있는 폴더를 확인합니다.

## 단계

1. 접힌 폴더를 선택하고 **편집 > Edit folder contents > Select folder contents**를 선택합니다. 폴더의 컨텍스트 메뉴에서도 같은 하위 메뉴를 사용할 수 있습니다.
2. 폴더 개요에서 시간 범위를 드래그하고 선택 시작과 끝을 확인합니다.
3. **Edit folder contents**에서 **Cut from folder and close gap**을 선택해 구간을 제거하고 폴더 안의 뒤쪽 자료를 이동해 빈틈을 닫습니다.
4. 복사한 자료를 넣으려면 **Insert clipboard into folder**를 사용하고 작업을 되돌리려면 **되돌리기**를 사용합니다.

## 결과 확인

폴더는 접힌 상태로 유지되며 하위 트랙에 편집이 적용됩니다. 나중에 폴더를 펼쳐 편집 내용을 확인하고 폴더 밖의 관련 없는 트랙이 그대로 있는지 확인합니다.

## 제한 및 복구

폴더 편집은 하위 항목에 적용되며 프로젝트 전체에 자동으로 적용되지 않습니다. 폴더 밖의 음악이나 앰비언스와 함께 편집 지점을 들어 의도한 타이밍 차이가 있는지 확인합니다. 그룹 편집 전에 잠금과 대상 폴더를 확인하고 큰 구조 변경 전 [스냅샷](/soundscaper/save-session-snapshots/)을 저장합니다.
