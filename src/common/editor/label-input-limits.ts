/* SPDX-License-Identifier: AGPL-3.0-only */

export const AUDIO_EDITOR_LABEL_MAX_INPUT_CHARS = 16 * 1024 * 1024;

// UTF-8 uses at most three bytes per UTF-16 code unit, plus its optional BOM.
// This also admits every UTF-16 and Windows-1252 input within the character cap.
export const AUDIO_EDITOR_LABEL_MAX_INPUT_BYTES = AUDIO_EDITOR_LABEL_MAX_INPUT_CHARS * 3 + 3;
