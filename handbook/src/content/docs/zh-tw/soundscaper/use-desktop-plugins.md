---
title: "使用桌面音訊外掛程式"
description: "在 Soundscaper 桌面版中尋找、啟用並試聽原生效果和樂器。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-luna","modelProvider":"codex-subagent"},"factPacketSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","model":"gpt-6","modelProvider":"codex","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ee294775a2938f1c35bb03712c6e4d726617fd3351241c60a1e5cfb69c886c18","targetLocale":"zh-TW"} -->

在 Soundscaper 桌面版中尋找、啟用並試聽原生效果和樂器。

## 開始之前

安裝與作業系統和支援的主機格式相容的外掛程式版本。支援的套件預設會提供內建桌面外掛程式；若要使用其他外掛程式，仍需掃描尋找，並可能需要授權。

## 步驟

1. 開啟 **效果器 > 插件管理**。搜尋清單，並使用 **掃描與設定** 設定掃描選項。
2. 選取外掛程式並檢查其版本、權限和復原控制項。適用時啟用它。
3. 透過 **效果器 > 音頻插件** 或即時效果架新增效果。使用 MIDI 音軌的樂器控制項選取原生樂器。
4. 試聽播放；若有需要，儲存預設，然後儲存專案。

## 透過吉他音箱演奏

從 **效果器 > 音頻插件** 或音軌的即時效果架加入 **OrbitAmp**。開啟外掛編輯器，在 **AMP** 區段選擇放大器，在 **CAB** 區段選擇揚聲器箱體。桌面版套件內含原廠音色。

## 檢查結果

只要相同的相容二進位檔可用，指定的外掛程式就應該能處理聲音，並在重新載入時恢復儲存的設定。交付前略過外掛程式進行比較，並檢查匯出結果。

## 限制與復原

Windows 套件支援持續維護的 VST2 橋接方式，包含支援的 32 位元外掛程式。Linux 可透過已安裝並設定完成的 yabridge/Wine 使用 Windows VST3；這不會替你安裝或授權第三方外掛程式。外掛程式預設不會包含二進位檔。如果外掛程式失效，請使用 Plugin Manager 的復原控制項，並在繼續工作前嘗試相容版本。
