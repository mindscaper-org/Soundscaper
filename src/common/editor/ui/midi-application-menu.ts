/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveMidiCopy } from '../../i18n/editor-midi-copy.ts';

interface MidiMenuContext {
	readonly copy: Readonly<Record<string, unknown>>;
	readonly productId: string;
	readonly blocked: boolean;
}

export function createMidiTrackMenuItems(context: MidiMenuContext, add: () => unknown) {
	return context.productId === 'soundscaper' ? [{
		id: 'new-midi-track', label: resolveMidiCopy(context.copy).track, preserveLabel: true,
		disabled: context.blocked, onClick: add,
	}] : [];
}

export function createMidiExportMenuItems(
	context: MidiMenuContext & { readonly midiAvailable: boolean },
	actions: Readonly<{ midi: () => unknown; allegro: () => unknown }>,
) {
	if (context.productId !== 'soundscaper') return [];
	const copy = resolveMidiCopy(context.copy);
	return [
		{ id: 'midi-export-file', label: copy.exportMidi, preserveLabel: true, disabled: context.blocked || !context.midiAvailable, onClick: actions.midi },
		{ id: 'allegro-export-file', label: copy.exportAllegro, preserveLabel: true, disabled: context.blocked || !context.midiAvailable, onClick: actions.allegro },
	];
}
