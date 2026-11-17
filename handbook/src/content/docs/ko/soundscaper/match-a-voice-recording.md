---
title: "음성 녹음의 음색 맞추기"
description: "음색 참조를 학습하고 Match EQ를 사용해 다른 녹음을 참조에 가깝게 조정합니다."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"ko"} -->

음색 참조를 학습하고 Match EQ를 사용해 다른 녹음을 참조에 가깝게 조정합니다.

## 시작하기 전에

들리는 전 주파수 대역이 포함된 참조 음원을 선택합니다. 길이는 최소 0.25초여야 하고, 같은 화자를 잘 녹음한 음원이 가장 좋습니다. 대상 녹음도 준비합니다. 이 기능은 브라우저와 데스크톱에서 로컬로 처리됩니다.

## 단계

1. 참조 음원을 선택하고 **이펙트 > 이퀄라이저 및 필터 > Match EQ**를 엽니다. **Learn reference from selection**을 선택합니다.
2. 이 음성 프로필을 다시 사용하려면 학습한 참조를 프리셋으로 저장합니다. 대화상자를 닫습니다.
3. 대상을 선택하고 Match EQ를 다시 엽니다. 필요한 경우 참조를 불러온 다음 **Analyze target**을 선택합니다.
4. **미리 보기**로 **원본**과 **Matched (level compensated)**를 비교합니다. 보정을 조정한 다음 **선택에 적용**을 선택하거나 **Edit as Filter Curve EQ**를 선택해 곡선을 편집합니다.

## 결과 확인

비슷한 음량으로 들어보고 음색 균형이 더 가까워졌는지 확인합니다. 적용된 오디오는 길이와 채널 수를 유지합니다. **되돌리기**로 적용을 되돌릴 수 있습니다.

## 제한 및 복구

Match EQ는 사라진 대역폭을 복원하거나 연기, 다이내믹, 공간 잔향, 음성 정체성을 맞출 수 없습니다. 참조 캡처에는 버스 및 마스터 앞의 트랙 효과가 포함되지만 대상은 트랙 랙 전에 분석됩니다. 참조의 원하는 소리가 후단 처리에 따라 달라지면 먼저 렌더링하세요.
