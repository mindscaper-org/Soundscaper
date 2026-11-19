---
title: "透過樂器播放 MIDI"
description: "為 MIDI 音符選擇合成器，並保留可編輯的演奏內容。"
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"zh-TW"} -->

為 MIDI 音符選擇合成器，並保留可編輯的演奏內容。

## 開始之前

開啟或匯入 MIDI，或在 Soundscaper 中建立新音軌。內建播放選項與選用的原生樂器不同。原生外掛程式樂器需要桌面應用程式和相符且已啟用的外掛程式。

## 步驟

1. 如需音軌，請選擇 **音軌 > 新增音軌 > MIDI track (beta)**。
2. 開啟 **視窗 > Piano roll (beta)**。新增音符或選取現有 MIDI 素材。
3. 選擇 **Instrument**。使用原生樂器時，開啟 **Instrument settings** 調整音色並儲存預設。
4. 開始播放，檢查音符和延音，然後儲存並重新開啟專案。

## 檢查結果

你應該會聽到所選樂器的聲音，而鋼琴捲軸中的音符仍可編輯。如果已安裝必要的外掛程式，重新開啟時樂器設定和預設都會恢復。

## 限制與復原

原生樂器適用於 MIDI 音軌，而不是一般音訊軌。儲存的預設不會包含外掛程式二進位檔或外部程式庫。支援的桌面套件預設會啟用內建樂器；其他樂器可能需要 [Plugin Manager](/soundscaper/use-desktop-plugins/)。依賴相同音色之前，請在目標電腦上檢查播放和匯出結果。
