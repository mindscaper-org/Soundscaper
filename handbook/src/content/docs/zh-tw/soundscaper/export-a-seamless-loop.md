---
title: "匯出包含效果尾音的循環"
description: "將混響或延遲尾音折回重複播放音訊檔案的開頭。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"zh-TW"} -->

將混響或延遲尾音折回重複播放音訊檔案的開頭。

## 開始之前

準備套用所需處理的精確循環範圍。檢查接點時使用 WAV 等無損格式。讓一般播放和匯出音量保持在削波之下。

## 步驟

1. 選取要重複播放的時間範圍，並開啟 **檔案 > 匯出音訊**。
2. 選取目前選取的範圍，以及適合的格式、取樣率和聲道配置。
3. 在匯出設定中啟用 **Render as loop**。匯出檔案。
4. 將結果匯入測試專案並聆聽數次循環，尤其注意接點。

## 檢查結果

匯出檔案會保留所選循環的時間長度，算繪後的尾音則會折回開頭。聆聽是否有喀嗒聲、音量突升或混響轉換不順。

## 限制與復原

尾音折回無法修復不合適的音樂剪接點或不連續的乾聲波形。它不同於會延長一般匯出的 **包含長達 10 秒的效果器尾聲**。尾音加總可能提高峰值；請降低音量或使用 Limiter 的選用真峰值限制，再檢查交付檔案。有損格式可能增加填補內容或改變峰值，因此也要確認實際交付格式。
