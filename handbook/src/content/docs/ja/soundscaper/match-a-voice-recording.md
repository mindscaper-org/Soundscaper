---
title: "音声録音の音色を合わせる"
description: "音色の基準を学習し、Match EQ で別の録音を近づけます。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"ja"} -->

音色の基準を学習し、Match EQ で別の録音を近づけます。

## 始める前に

聞き取れる全帯域の基準音声を選びます。長さは少なくとも4分の1秒で、同じ話者の良好な録音が理想です。対象の録音も用意します。この処理はブラウザーとデスクトップの両方でローカルに行われます。

## 手順

1. 基準音声を選択し、**エフェクト > EQとフィルター > Match EQ** を開きます。**Learn reference from selection** を選びます。
2. この声のプロファイルを再利用する場合は、学習した基準をプリセットとして保存します。ダイアログを閉じます。
3. 対象を選び、Match EQ を再度開きます。必要なら基準を呼び出し、**Analyze target** を選びます。
4. **プレビュー** で **オリジナル** と **Matched (level compensated)** を比較します。補正を調整してから **選択範囲に適用** を選ぶか、**Edit as Filter Curve EQ** でカーブを編集します。

## 結果を確認する

同程度の音量で聞き、音色のバランスが近づいたか確認します。適用後も音声の長さとチャンネル数は変わりません。**取り消す** で適用を取り消せます。

## 制限と復旧

Match EQ は失われた帯域を復元できず、演技、ダイナミクス、部屋の残響、声の個性も一致させられません。基準の取り込みにはバスとマスターより前のトラックエフェクトが含まれますが、対象はトラックラックより前で解析されます。基準音の希望する響きが後段の処理に依存する場合は、先に基準をレンダリングしてください。
