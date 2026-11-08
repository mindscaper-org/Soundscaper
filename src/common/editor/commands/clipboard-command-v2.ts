/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorClipboard, AudioEditorCommand } from './protocol.ts';
import { normalizeAudioEditorClipboardDescriptorV7, type AudioEditorClipboardV7 } from './clipboard-codec-v7.ts';
import { isAudioEditorLabelClipboardDescriptor } from './clipboard-codec.ts';

export type CurrentAudioEditorClipboardDescriptor = AudioEditorClipboard | AudioEditorClipboardV7;
export interface CurrentAudioEditorClipboardPasteCommandV2 extends Omit<
	Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>, 'clipboard'
> {
	readonly clipboard: CurrentAudioEditorClipboardDescriptor;
}
export interface AudioEditorClipboardPasteCommandV2 extends CurrentAudioEditorClipboardPasteCommandV2 {
	readonly clipboard: AudioEditorClipboardV7;
}
export interface AudioEditorClipboardCommandBatchV2 {
	readonly type: 'batch';
	readonly commands: readonly CurrentAudioEditorMutationCommandV2[];
}
export type CurrentAudioEditorMutationCommandV2 = AudioEditorCommand | CurrentAudioEditorClipboardPasteCommandV2 | AudioEditorClipboardCommandBatchV2;
/** The same numeric wire7 tag names two disjoint closed domains. Admit the owner shape. */
export function isCurrentAudioEditorFrameClipboardDescriptorV7(value: unknown): value is AudioEditorClipboardV7 {
	if (isAudioEditorLabelClipboardDescriptor(value)) return false;
	const schema = value && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, 'schemaVersion') : undefined;
	if (!schema || !Object.hasOwn(schema, 'value') || schema.value !== 7) return false;
	normalizeAudioEditorClipboardDescriptorV7(value);
	return true;
}

export function isCurrentClipboardPasteCommandV2(command: CurrentAudioEditorMutationCommandV2): command is AudioEditorClipboardPasteCommandV2 {
	return command.type === 'clipboard/paste' && isCurrentAudioEditorFrameClipboardDescriptorV7(command.clipboard);
}
