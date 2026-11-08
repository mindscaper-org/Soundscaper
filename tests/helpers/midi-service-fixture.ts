/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAudioEditorProjectV17, type AudioEditorProjectV17Options } from '../../src/common/editor/project-v17.ts';
import { applyEditorCommand } from '../../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import { createMidiService } from '../../src/common/editor/controller/track-audio/midi-service.ts';
import type { MidiServiceDependencies } from '../../src/common/editor/controller/track-audio/midi-service-types.ts';

export function midiServiceFixture(options: AudioEditorProjectV17Options = {}) {
	let project = createAudioEditorProjectV17({ sampleRate: 8000, ...options });
	let sequence = 0;
	const pcm = new Map<string, Float32Array[]>();
	const saves: Readonly<Record<string, unknown>>[] = [];
	const dependencies: MidiServiceDependencies = {
		getProject: () => project, editingBlocked: () => false,
		commit: command => { project = applyEditorCommand(project, command); },
		createId: prefix => `${prefix}-${++sequence}`, trackName: () => 'MIDI', clipName: () => 'MIDI',
		store: { beginSourceWrite: async id => {
			const chunks: Float32Array[] = []; pcm.set(id, chunks);
			return { write: channels => { chunks.push(channels[0]!); }, commit: () => undefined, abort: () => undefined };
		}, deleteSource: async id => { pcm.delete(id); } },
		previewNote: async () => undefined, saveFile: request => { saves.push(request); },
	};
	return { service: createMidiService(dependencies), dependencies, pcm, saves, project: () => project,
		apply(command: AudioEditorCommand) { project = applyEditorCommand(project, command); } };
}
