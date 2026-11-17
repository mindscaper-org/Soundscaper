---
title: "比對人聲錄音的音色"
description: "學習音色參考，並使用 Match EQ 讓另一段錄音更接近它。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"zh-TW"} -->

學習音色參考，並使用 Match EQ 讓另一段錄音更接近它。

## 開始之前

選擇一段清晰可聽、頻率範圍完整且至少四分之一秒的參考音訊；最好是同一位講者錄得良好的音訊。準備好目標錄音。這項功能在瀏覽器與桌面版都使用本機處理。

## 步驟

1. 選取參考音訊並開啟 **效果器 > EQ 與過濾器 > Match EQ**。選擇 **Learn reference from selection**。
2. 若要重複使用此聲音設定檔，請將學習到的參考儲存為預設。關閉對話框。
3. 選取目標音訊，重新開啟 Match EQ；必要時載入參考，再選擇 **Analyze target**。
4. 使用 **預覽** 比較 **原始** 與 **Matched (level compensated)**。調整校正量，接著選擇 **套用至選取範圍**，或選擇 **Edit as Filter Curve EQ** 編輯曲線。

## 檢查結果

以相近的響度聆聽，確認音色平衡是否更接近。套用後的音訊會保留原有時間長度與聲道數。**復原** 會復原套用動作。

## 限制與復原

Match EQ 無法還原已遺失的頻寬，也無法比對表演方式、動態、房間殘響或聲音身分。擷取參考音訊時會包含匯流排與主控之前的音軌效果；目標則是在音軌效果架之前分析。如果想要的參考聲音取決於後段處理，請先算繪參考音訊。
