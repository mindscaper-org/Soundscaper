/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoKeyframeCurves } from '../video-keyframe-curves.ts';
import { normalizeAudioEditorClipboardDescriptorCore } from './clipboard-codec-core.ts';
import { normalizeLabelClipboardDescriptor, type LabelClipboardDescriptor } from './label-clipboard-codec.ts';
export { collectAudioEditorClipboardSourceIds, clipboardRequiresTimelineAnnotationCapability } from './clipboard-codec-core.ts';
export const AUDIO_EDITOR_COMMAND_CLIPBOARD_SCHEMA_VERSION = 6;

const OWNER = Object.freeze({ version: 6 as const, normalizeKeyframes: normalizeVideoKeyframeCurves });

/** Label claims enter their complete closed codec; a numeric tag alone selects no owner. */
export function isAudioEditorLabelClipboardDescriptor(value: unknown): value is LabelClipboardDescriptor {
	if (!hasLabelShape(value)) return false;
	normalizeLabelClipboardDescriptor(value);
	return true;
}

/** Retain legacy media1–6 and the separate Label7 wire; Frame7 keeps its named owner. */
export function normalizeAudioEditorClipboardDescriptor(value: unknown) {
	if (hasLabelShape(value)) return normalizeLabelClipboardDescriptor(value);
	return normalizeAudioEditorClipboardDescriptorCore(value, OWNER);
}

function hasLabelShape(value: unknown): boolean {
	return value !== null && typeof value === 'object' && Object.hasOwn(value, 'labels');
}
