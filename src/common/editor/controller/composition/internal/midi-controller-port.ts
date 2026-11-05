/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ProjectChangedOptions } from '../../document/project-mutation-service.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { MidiTransferSelection, MidiTransferSnapshot } from '../../track-audio/midi-service-types.ts';

export interface MidiControllerBinding {
	settled(): Promise<void>;
	hasPendingEdits(): boolean;
	commitTransfer(command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot,
		selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown;
}

/** One controller owns one lazy MIDI queue shared by gestures, saves and transfers. */
export function createMidiControllerPort() {
	let owner: MidiControllerBinding | null = null;
	return Object.freeze({
		bind(value: MidiControllerBinding): void {
			if (owner && owner !== value) throw new Error('The MIDI controller owner is already bound.');
			owner = value;
		},
		settled: async (): Promise<void> => { await owner?.settled(); },
		hasPendingEdits: (): boolean => owner?.hasPendingEdits() ?? false,
		commitTransfer(command: AudioEditorCommand, preview: (command: AudioEditorCommand) => MidiTransferSnapshot,
			selection?: MidiTransferSelection, options?: ProjectChangedOptions): unknown {
			if (!owner) throw new Error('The MIDI controller is not ready.');
			return owner.commitTransfer(command, preview, selection, options);
		},
	});
}
export type MidiControllerPort = ReturnType<typeof createMidiControllerPort>;
