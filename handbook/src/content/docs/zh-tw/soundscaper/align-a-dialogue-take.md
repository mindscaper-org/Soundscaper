---
title: "對齊替換的對白錄音"
description: "將同一句對白的第二次演出配合參考片段。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c6041204950f16f97736a1197c2d7dd2e48d6324df69324ce5364ae015a90928","targetLocale":"zh-TW"} -->

將同一句對白的第二次演出配合參考片段。

## 開始之前

準備兩個已解除鎖定的單聲道或立體聲音訊片段，每段長度為 0.25–30 秒。兩段必須包含相同台詞，表達方式也要大致相似。先算繪或取消連結與影片連動或錨定節拍的素材。

## 步驟

1. 開啟 **編輯 > 音訊片段 > Align dialogue**。
2. 明確選擇參考和替換片段，再設定對齊強度。
3. 選擇 **Analyze and align**。比較 **Play reference**、**Play replacement** 和 **Play aligned**。仔細聆聽子音與呼吸聲。
4. 確認結果聽起來合適後，再選擇 **Create aligned copy**。

## 檢查結果

新的音軌會在參考片段的起點和時間長度新增已對齊的副本。原始片段仍可使用。**復原** 可用一個步驟移除新增的副本。儲存並重新開啟，即可繼續使用已算繪結果，無須重做分析。

## 限制與復原

替換片段的時間長度必須介於參考片段的一半到兩倍之間。對齊是以聲學為基礎，不會檢查嘴型或驗證逐字稿。不同台詞、背景噪音或重疊的講者都可能導致失敗。如果分析無法配對，請使用更短且相同的語句，或手動編輯。變更輸入或強度後，必須重新分析。
