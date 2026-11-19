---
title: "세션 스냅샷 저장 및 복원"
description: "다른 편집을 시도하기 전에 편곡 버전을 이름을 지정해 저장합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"ko"} -->

다른 편집을 시도하기 전에 편곡 버전을 이름을 지정해 저장합니다.

## 시작하기 전에

보존하려는 오디오가 들어 있고 쓰기 가능한 Soundscaper 프로젝트를 엽니다. 스냅샷은 이 프로젝트에 속합니다. 별도의 백업으로 휴대용 프로젝트 파일도 저장하세요.

## 단계

1. **파일 > Session snapshots**를 엽니다.
2. “대사 컷 편집 전”과 같은 **Snapshot name**을 입력하고 **Create snapshot**을 선택합니다. 대화상자를 닫고 편집합니다.
3. 해당 버전으로 돌아가려면 대화상자를 다시 열고 **Saved snapshots**에서 스냅샷을 선택한 다음 **Restore snapshot**을 선택합니다.
4. **Rename snapshot**을 사용해 버전 이름을 더 명확히 하거나, 필요하지 않은 스냅샷은 **Delete snapshot**으로 삭제합니다.

## 결과 확인

이전 편곡과 보존된 오디오가 복원됩니다. 대화상자를 닫고 복원한 구간을 재생합니다. **되돌리기**는 복원을 되돌리고, **다시 실행**는 다시 복원합니다.

## 제한 및 복구

스냅샷은 이름이 지정된 프로젝트 상태이지 외부 백업이 아닙니다. 현재 편곡에서 제거한 오디오도 보존할 수 있어 저장 공간을 사용합니다. 스냅샷을 삭제해도 현재 편곡은 그대로입니다. [프로젝트 백업](/projects-and-data/storage-backups-and-privacy/)을 참조하세요.
