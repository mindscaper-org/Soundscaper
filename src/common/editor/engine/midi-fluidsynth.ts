/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MidiLibrarySynth } from './midi-library-renderer.ts';
import { createMidiReferenceSoundFont } from './midi-soundfont-reference.ts';

export async function openFluidSynth(sampleRate: number): Promise<MidiLibrarySynth> {
	const imported = await import('js-synthesizer');
	const api = imported.Synthesizer ? imported : (imported as unknown as { default: typeof imported }).default;
	const { Synthesizer } = api;
	const module = await import('js-synthesizer/externals/libfluidsynth-2.4.6.js');
	Synthesizer.initializeWithFluidSynthModule(module.default);
	await Synthesizer.waitForWasmInitialized();
	const synth = new Synthesizer();
	synth.init(sampleRate, { chorusActive: false, reverbActive: false, polyphony: 256, minNoteLength: 0 });
	try {
		// The Emscripten filesystem emits stub diagnostics even for valid in-memory banks.
		// Loader failures still reject; restore ordinary logging after this isolated load.
		api.disableLogging();
		try { await synth.loadSFont(createMidiReferenceSoundFont()); } finally { api.restoreLogging(); }
		return { render: channels => { synth.render(channels); }, send(bytes) {
			const status = bytes[0]!, channel = status & 15, first = bytes[1]!, second = bytes[2]!;
			switch (status & 240) {
				case 0x80: synth.midiNoteOff(channel, first); break;
				case 0x90: synth.midiNoteOn(channel, first, second); break;
				case 0xa0: synth.midiKeyPressure(channel, first, second); break;
				case 0xb0: synth.midiControl(channel, first, second); break;
				case 0xc0: synth.midiProgramChange(channel, first); break;
				case 0xd0: synth.midiChannelPressure(channel, first); break;
				case 0xe0: synth.midiPitchBend(channel, first | second << 7); break;
			}
		}, close: () => synth.close() };
	} catch (error) { synth.close(); throw error; }
}
