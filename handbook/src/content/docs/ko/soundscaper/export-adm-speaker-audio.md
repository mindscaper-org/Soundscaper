---
title: "스피커용 ADM 프로그램 렌더링"
description: "EBU EAR를 사용해 제작한 ADM 베드와 오브젝트를 일반 스피커 오디오로 내보냅니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5af5c8eeeac85ba578ac51c27f066d77851b7c1a9128257d3b919b71a1c76825","targetLocale":"ko"} -->

EBU EAR를 사용해 제작한 ADM 베드와 오브젝트를 일반 스피커 오디오로 내보냅니다.

## 시작하기 전에

Metadata editor의 ADM 탭에서 베드 할당과 위치가 지정된 오브젝트를 포함하는 ADM 프로그램을 제작합니다. 전달할 스피커 레이아웃을 확인하고 필요한 채널 수를 담을 수 있는 컨테이너와 코덱을 선택합니다.

## 단계

1. **파일 > 오디오 내보내기**를 엽니다.
2. **렌더링 > EBU EAR speaker rendering**에서 stereo, 5.1, 5.1.2, 5.1.4, 7.1, 7.1.4 레이아웃 중 하나를 선택합니다.
3. 출력 형식, 채널 수, 레벨 설정을 확인한 다음 내보냅니다.
4. 전달 보고서를 읽고 해당 스피커 레이아웃을 통해 내보낸 파일을 들어봅니다.

## 결과 확인

출력에는 선언된 채널 순서에 따라 렌더링된 스피커 PCM이 포함됩니다. 이 내보내기 옵션은 프로젝트 모니터링이나 원래 ADM 제작을 바꾸지 않습니다. 보고서에서 사용된 렌더러와 레이아웃을 확인합니다.

## 제한 및 복구

EAR 스피커 렌더링과 헤드폰 렌더링은 결합할 수 없습니다. 분할 출력과 BW64/ADM 패스스루에서는 이 옵션을 사용할 수 없습니다. 렌더링된 채널에는 원본 bed/object ADM 메타데이터가 포함되지 않습니다. 이 교환에는 렌더링하지 않은 BW64를 사용합니다. 이동 또는 확산 오브젝트, HOA, 베이스 관리, 인증된 Dolby 렌더링은 이 기능의 범위에 포함되지 않습니다. 일반 음량 미터는 전달 채널을 최대 8개까지 지원합니다.
