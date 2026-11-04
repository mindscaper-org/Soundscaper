/* SPDX-License-Identifier: AGPL-3.0-only */
import { renderMidiFrames } from '../../engine/midi-synthesis.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { MidiInstrument } from '../../midi-model.ts';

export async function previewMidiNote(engine: Pick<EnginePublicApi, 'getAudioContext'>, pitch: number, instrument: MidiInstrument): Promise<void> {
	const context = await engine.getAudioContext();
	const frames = Math.round(context.sampleRate * 0.35);
	const buffer = context.createBuffer(1, frames, context.sampleRate);
	buffer.copyToChannel(renderMidiFrames([{ id: 'preview', pitch, startFrame: 0, durationFrames: frames, velocity: 100, channel: 0 }], instrument, context.sampleRate, 0, frames), 0);
	const source = context.createBufferSource();
	source.buffer = buffer;
	source.connect(context.destination);
	source.onended = () => source.disconnect();
	source.start();
}
