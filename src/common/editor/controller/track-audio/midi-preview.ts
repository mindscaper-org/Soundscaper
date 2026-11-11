/* SPDX-License-Identifier: AGPL-3.0-only */
import { openMidiAudioRenderer } from '../../engine/midi-audio-renderer.ts';
import type { EnginePublicApi } from '../../engine/public-api.ts';
import type { MidiInstrument } from '../../midi-model.ts';
import { raceAbortableRead } from '../../../foundation/abort-race.ts';

export async function previewMidiNote(engine: Pick<EnginePublicApi, 'getAudioContext' | 'getPlaybackDestination'>, pitch: number, instrument: MidiInstrument, signal?: AbortSignal): Promise<void> {
	const context = await raceAbortableRead(() => engine.getAudioContext(), signal, 'immediate');
	signal?.throwIfAborted();
	const frames = Math.round(context.sampleRate * 0.35);
	const render = await openMidiAudioRenderer({ version: 1, notes: [{ id: 'preview', pitch, startFrame: 0, durationFrames: frames, velocity: 100, channel: 0 }] }, instrument, context.sampleRate);
	const buffer = context.createBuffer(render.channelCount, frames, context.sampleRate);
	try {
		const planes = await render.render(0, frames);
		for (let channel = 0; channel < planes.length; channel++) buffer.copyToChannel(planes[channel]!, channel);
	} finally { await render.close(); }
	signal?.throwIfAborted();
	const source = context.createBufferSource();
	source.buffer = buffer;
	await new Promise<void>((resolve, reject) => {
		const finish = () => {
			signal?.removeEventListener('abort', abort);
			source.onended = null;
			source.disconnect();
		};
		const abort = () => {
			finish();
			try { source.stop(); } finally { reject(signal?.reason); }
		};
		source.onended = () => { finish(); resolve(); };
		signal?.addEventListener('abort', abort, { once: true });
		try {
			source.connect(engine.getPlaybackDestination());
			source.start();
		} catch (error) { finish(); reject(error); }
	});
}
