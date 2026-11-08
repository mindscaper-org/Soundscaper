/* SPDX-License-Identifier: AGPL-3.0-only */
import { COPY, createAudioEditorController, createMemoryEngine } from './audio-editor-controller-harness.js';
import { createMemoryStore } from './audio-editor-memory-store-baseline.js';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';

export async function midiControllerPcmFixture() {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const memory = createMemoryStore();
	const pcm = new Map<string, Float32Array[]>();
	let writeGate: Promise<void> | null = null;
	let onWrite = () => {};
	const store = { ...memory, async beginSourceWrite(id: string) {
		const chunks: Float32Array[] = [];
		return { async write(channels: readonly Float32Array[]) { onWrite(); await writeGate; chunks.push(channels[0]!); },
			commit() { pcm.set(id, chunks); memory.audioSources.set(id, chunks); }, abort() {} };
	}, async deleteSource(id: string) { pcm.delete(id); memory.audioSources.delete(id); } };
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		store: store as unknown as Options['store'], engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	await controller.ready;
	return { controller, pcm, store, holdSourceWrites(gate: Promise<void>, entered: () => void) { writeGate = gate; onWrite = entered; } };
}
