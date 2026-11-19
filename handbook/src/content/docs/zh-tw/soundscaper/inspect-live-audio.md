---
title: "播放時檢查聲音"
description: "使用 Analysis 面板檢視即時頻譜、響度、立體聲檢查和 ACX 音訊報告。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"85b26bbd1bc97b708c3e8e62ddfc80986c24be6c078c7c997c569f88fd918643","targetLocale":"zh-TW"} -->

使用 Analysis 面板檢視即時頻譜、響度、立體聲檢查和 ACX 音訊報告。

## 開始之前

開啟包含音訊的專案。先決定要檢查播放內容或選取範圍：時間選取範圍可能會將頻譜切換為選取範圍分析。

## 步驟

1. 開啟 **分析 > 分析**。展開需要的區段，例如 **Spectrum**、頻譜圖、響度或相關性。
2. 清除時間選取範圍並開始播放，即可檢視即時畫面。在頻譜中比較音軌疊加圖，找出互相競爭的頻率範圍。
3. 停止播放並選取一個片段，即可在未播放時檢視其頻譜。
4. 檢查有聲書時，展開 **ACX compliance** 並選擇 **Check audio**。閱讀結果表；使用 **匯出** 匯出 JSON 報告。

## 檢查結果

即時顯示會隨著播放更新。ACX 報告會逐項列出音訊檢查的通過或失敗，而不只是顯示音量表。修正未通過的音量或格式設定，再重新檢查。

## 限制與復原

頻譜顯示能量，不代表混音聽起來好不好。相關性和響度需要結合脈絡並實際聆聽。ACX 音訊檢查不保證出版服務會接受，也不會檢查所有編輯要求。收合 ACX 區段會清除顯示的檢查結果；需要時請重新執行。關閉不需要的分析器區段，以減少畫面處理工作。
