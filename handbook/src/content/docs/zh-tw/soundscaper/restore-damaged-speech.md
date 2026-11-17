---
title: "使用本機模型修復受損語音"
description: "套用至錄音前，先檢閱選用的語音修復結果。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b0f7979f2aaa38569448b78505dc88a35b1ac2411af570ba9f9d78e7dd80e3e8","targetLocale":"zh-TW"} -->

套用至錄音前，先檢閱選用的語音修復結果。

## 開始之前

使用桌面應用程式並選取要修復的語音。保留原始音訊或快照。工作中顯示的模型取決於已發佈的目錄和已安裝的執行環境；目前版本可能不提供 VoiceFixer。

## 步驟

1. 開啟 **效果器 > 噪音移除與修復 > 增強對話**。
2. 選擇相容的 **模型**。如果有 **VoiceFixer**，它的用途是處理語音削波與修復；如有需要，請透過模型控制項明確安裝。
3. 執行工作後，選擇 **審閱結果**，將建議音訊與原始音訊一起聆聽。
4. 只有語音有所改善時才接受建議。套用前檢查選取的位置，然後儲存專案。

## 檢查結果

聆聽修復後的峰值與更清晰的語音，同時也注意母音、呼吸聲和背景音的變化。接受的結果會成為可供試聽與復原的音訊編輯；拒絕或關閉檢閱畫面不會套用結果。

## 限制與復原

VoiceFixer 會重新合成語音，因此可能改變音色和背景內容。它不是一般的音樂削波修復工具。如果模型選擇器中沒有它，請使用提供的增強工具或[修復削波峰值指南](/guides/cleaning-up/restore-clipped-peaks/)；只要照著步驟操作，並不能啟用未提供的模型。
