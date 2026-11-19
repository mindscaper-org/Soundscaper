---
title: "저장한 프로젝트를 연결된 오디오로 재사용"
description: "저장한 프로젝트를 다른 편곡에 삽입하고 이후 편집 내용도 반영합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ff1eb7c442461290d4b0b61fc89870619cc8872f4ee2143e65283db0dc1defa9","targetLocale":"ko"} -->

저장한 프로젝트를 다른 편곡에 삽입하고 이후 편집 내용도 반영합니다.

## 시작하기 전에

자식 Soundscaper 프로젝트를 같은 로컬 프로젝트 라이브러리에 저장합니다. 먼저 믹스를 완성하세요. 백그라운드 하위 프로젝트 렌더러를 사용하기 전에 활성 네이티브 플러그인 처리를 렌더링해 오디오에 반영합니다.

## 단계

1. 부모 프로젝트를 열고 **파일 > Subprojects**를 선택합니다.
2. **Project to insert or relink**에서 자식 프로젝트를 선택한 다음 **Insert subproject**를 선택합니다. 게시된 믹스가 새 트랙에 표시됩니다.
3. **Linked subprojects**에서 링크를 선택하고 **Open subproject**를 선택해 자식 프로젝트를 편집합니다. 저장한 다음 부모 프로젝트로 돌아와 갱신된 오디오를 들어봅니다.
4. 이 버전을 유지하려면 **Pin current audio**를 선택하고, 자식 프로젝트 변경을 더는 반영하지 않으려면 **Make independent audio**를 선택합니다.

## 결과 확인

자식 프로젝트가 갱신되어도 부모 프로젝트의 배치 위치는 그대로 유지됩니다. 갱신 후 재생해 시작과 끝을 확인합니다. 자식 믹스가 더 짧으면 원래 게시 범위 안에 무음이 채워집니다.

## 제한 및 복구

게시된 길이와 채널 레이아웃은 고정됩니다. 다른 범위가 필요하면 별도 배치를 삽입하세요. 휴대용 부모 파일에는 설치된 오디오가 포함되지만 편집 가능한 자식 프로젝트는 포함되지 않습니다. 자식 프로젝트는 따로 전송하고 **Relink to selected project**를 사용하세요. 순환 링크는 거부됩니다.
