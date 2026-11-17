---
title: "從其他編輯器匯入音訊工作階段"
description: "匯入支援的音訊編輯、重新連結媒體，並檢閱轉換限制。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"zh-TW"} -->

匯入支援的音訊編輯、重新連結媒體，並檢閱轉換限制。

## 開始之前

將工作階段與音訊複製到可存取的資料夾。支援匯入的原生音訊工作階段包含 REAPER `.rpp`、Hindenburg `.nhsx`、Pro Tools `.pts`/`.ptf`/`.ptx`、Ardour `.ardour`、SoundCraft 工作階段，以及 Audition `.sesx` 或舊版 `.ses`。保留原始專案。

## 步驟

1. 選擇 **檔案 > 已開啟** 或 **檔案 > 匯入**，也可以將工作階段拖放到工作區。
2. 在瀏覽器中，選取工作階段附帶的音訊。在桌面版，依照提示授予媒體資料夾存取權。
3. 開啟 **檔案 > 交付報告**。檢查省略和轉換項目，必要時重新連結離線媒體。
4. 聆聽具代表性的編輯與淡變，檢查音軌順序和時間，並儲存成新的 Scape 專案。

## 檢查結果

匯入的剪輯應與可存取的來源音訊對齊。將結果與原編輯器中的參考混音比較，尤其注意處理、路由或自動化可能造成的差異。

## 限制與復原

原生匯入會轉換音訊編輯，不保證混音完全相同。支援細節會因格式而異；來源工作階段中的外掛程式不會執行。REAPER 會使用啟用中的音訊 take，並省略替代 take 編輯、MIDI、路由和外掛程式。若要與其他 DAW 交換內容，請使用 AES31 ADL 或 DAWproject 等支援的交換格式，而不要期待能寫回原生工作階段檔案。
