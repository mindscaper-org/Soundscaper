---
title: "손상된 Audacity 프로젝트에서 오디오 복구"
description: "손상된 프로젝트를 진단하고 복구된 작업을 별도의 사본으로 저장합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"f4aa18a820f00d839f2a3c2eb08f911c2444e199d6e4fa8e842b5922a215bcd6","targetLocale":"ko"} -->

손상된 프로젝트를 진단하고 복구된 작업을 별도의 사본으로 저장합니다.

## 시작하기 전에

먼저 손상된 Audacity 프로젝트의 복사본을 만듭니다. 사용 가능한 사이드카 파일도 함께 보관합니다. 복구 기능은 지원되는 `.aup3`와 Audacity 미저장 프로젝트 파일을 처리할 수 있지만 사라진 샘플을 다시 만들 수는 없습니다.

## 단계

1. **파일 > 프로젝트 관리 > Audacity 프로젝트 복구**를 엽니다.
2. 손상된 프로젝트를 선택합니다. 가져오거나 저장하기 전에 **Recovery assessment**를 읽습니다.
3. 영향을 받은 위치의 추가 페이지를 포함해 **Missing audio ranges**를 확인합니다.
4. **Save repaired Audacity copy**가 제공되면 선택합니다. 그렇지 않으면 복구 결과를 열고 호환성 보고서를 확인한 다음 새 이름으로 저장합니다.

## 결과 확인

복구된 구간을 재생하고 보고서와 비교해 공백이나 무음을 확인합니다. 새 사본이 열리는지 확인한 뒤 사용합니다. 다음 복구 시도에 대비해 손상된 원본 파일을 보관합니다.

## 제한 및 복구

복구 과정에서 유효한 오디오 앞부분을 살리고 빠진 샘플을 무음으로 대체할 수 있습니다. 데이터베이스가 복구되었다고 해서 모든 오디오가 남았거나 모든 네이티브 편집 기능이 이전되는 것은 아닙니다. 보고서의 누락 항목을 확인하고 진단 중 유일한 원본을 덮어쓰지 마세요. 손상되지 않은 일반 프로젝트에는 [Audacity 가져오기 안내서](/guides/projects/open-an-audacity-project/)를 사용합니다.
