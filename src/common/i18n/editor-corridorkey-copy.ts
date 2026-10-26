/* SPDX-License-Identifier: AGPL-3.0-only */
import { resolveEditorCopyScope } from './editor-copy-scope.ts';
export const CORRIDORKEY_COPY = Object.freeze({
	title: 'CorridorKey 2.0',
	description: 'Remove a green screen from the selected video clip. The complete source is processed while this clip keeps its trims and retiming.',
	supported: 'Currently supports short, opaque video sources with a constant frame rate in display-referred SDR. The source duration limit depends on its resolution. Existing alpha, HDR, and scene-linear sources are unavailable.',
	unavailable: 'CorridorKey 2.0 is not available in this build. Its model download will appear here when publication is ready.',
	run: 'Key selected clip', decoding: 'Decoding source frames', running: 'Keying source frames',
	encoding: 'Encoding transparent video', publishing: 'Adding keyed video to the project',
	selectVideo: 'Select one video clip to key.',
	hintTitle: 'Alpha hint', hintEnabled: 'Run Chroma Key first',
	hintDescription: 'Use the normal Chroma Key matte to guide CorridorKey. The original colors are passed to the model.',
	hintColor: 'Key color', similarity: 'Similarity', softness: 'Softness', hintQuality: 'Hint strength',
});
export function resolveCorridorKeyCopy(copy: Readonly<Record<string, unknown>> = {}) {
	return resolveEditorCopyScope('corridorKey', CORRIDORKEY_COPY, copy);
}
