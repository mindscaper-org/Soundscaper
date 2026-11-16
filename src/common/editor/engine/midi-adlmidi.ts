/* SPDX-License-Identifier: AGPL-3.0-only */
import { AdlMidiCore } from 'libadlmidi-js/core';
import { defaultInstrument } from 'libadlmidi-js/structs';
import type { MidiLibrarySynth } from './midi-library-renderer.ts';

export async function openAdlMidi(sampleRate: number): Promise<MidiLibrarySynth> {
	const browser = import.meta.env?.DEV || import.meta.env?.PROD;
	const corePath = browser ? (await import('libadlmidi-js/dist/libadlmidi.nuked.slim.core.js?url')).default
		: import.meta.resolve('libadlmidi-js/dist/libadlmidi.nuked.slim.core.js');
	const wasmBinary = browser ? await fetch((await import('libadlmidi-js/dist/libadlmidi.nuked.slim.core.wasm?url')).default).then(response => {
		if (!response.ok) throw new Error('The FM synthesis runtime could not be loaded.'); return response.arrayBuffer();
	}) : undefined;
	const core = await AdlMidiCore.create({ corePath, wasmBinary, defaultEmulator: 1 });
	try {
		if (!core.init(sampleRate) || !core.setNumChips(8)) throw new Error('The FM synthesizer could not initialize.');
		// Slim build: only original, reproducible FM patches are distributed; no game-derived banks.
		for (let percussive = 0; percussive < 2; percussive++) for (let program = 0; program < 128; program++) {
			const patch = defaultInstrument(), family = Math.floor(program / 8);
			patch.isBlank = false; patch.percussionKey = percussive ? program : 0; patch.feedback1 = family % 5;
			for (let operator = 0; operator < 2; operator++) Object.assign(patch.operators![operator]!, {
				attack: 15, decay: 4 + family % 4, sustain: percussive ? 15 : 4, release: 7,
				freqMult: operator ? 1 : 1 + family % 4, totalLevel: operator ? 8 : 24 + family % 16,
				sustaining: !percussive, waveform: 0,
			});
			if (!core.setInstrument({ percussive, msb: 0, lsb: 0 }, program, patch)) throw new Error('The FM reference bank could not initialize.');
		}
		return { render(channels) {
			const output = core.generate(channels[0]!.length);
			for (let frame = 0; frame < channels[0]!.length; frame++) { channels[0]![frame] = output[frame * 2]!; channels[1]![frame] = output[frame * 2 + 1]!; }
		}, send(bytes) {
			const status = bytes[0]!, channel = status & 15, first = bytes[1]!, second = bytes[2]!;
			switch (status & 240) {
				case 0x80: core.noteOff(channel, first); break;
				case 0x90: core.noteOn(channel, first, second); break;
				case 0xa0: core.noteAfterTouch(channel, first, second); break;
				case 0xb0: core.controllerChange(channel, first, second); break;
				case 0xc0: core.programChange(channel, first); break;
				case 0xd0: core.channelAfterTouch(channel, first); break;
				case 0xe0: core.pitchBend(channel, first | second << 7); break;
			}
		}, close: () => core.close() };
	} catch (error) { core.close(); throw error; }
}
