/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneVideoEffects } from '../video-effects.js';
import { isAudioEditorLabelClipboardDescriptor, normalizeAudioEditorClipboardDescriptor } from './clipboard-codec.ts';
import { cloneVideoKeyframeCarrierFields } from './video-keyframe-carrier.ts';
import { createClipboardRuntimeOwner } from './clipboard-runtime-core.js';

/** Label7 uses native label commands, never this media-paste implementation.
 * @param {unknown} value
 */
function normalizeMediaClipboard(value) {
	const clipboard = normalizeAudioEditorClipboardDescriptor(value);
	if (isAudioEditorLabelClipboardDescriptor(clipboard)) throw new TypeError('A label clipboard requires native label paste preparation.');
	return clipboard;
}

const LEGACY = createClipboardRuntimeOwner(Object.freeze({ version: 6,
	normalizeClipboard: normalizeMediaClipboard, cloneEffects: cloneVideoEffects,
	cloneKeyframes: cloneVideoKeyframeCarrierFields }));
export const { createClipboardDescriptor, preparePasteCommand, prepareCut, pasteClipboard } = LEGACY;
