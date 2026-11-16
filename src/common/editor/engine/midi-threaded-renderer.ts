/* SPDX-License-Identifier: AGPL-3.0-only */
import { WorkerRequestBroker } from '../worker-request-broker.ts';
import { openMidiAudioRenderer } from './midi-audio-renderer.ts';
import type { MidiClipData, MidiInstrument } from '../midi-model.ts';
import type { MidiAudioRenderer } from './midi-demand-source.ts';
import type { MidiRenderWorkerRequest } from './midi-render-worker.ts';
import type { MidiAudioEventTimeline } from './midi-audio-events.ts';

export interface MidiRenderWorkerPort {
	postMessage(message: MidiRenderWorkerRequest): void;
	terminate(): void;
	addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

/** Browser DSP stays on a dedicated worker; native DSP already runs in its isolated host. */
export async function openThreadedMidiRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number,
	createWorker: () => MidiRenderWorkerPort = () => new Worker(new URL('./midi-render-worker-entry.ts', import.meta.url), { type: 'module', name: 'soundscaper-midi' }),
	initialFrame = 0,
): Promise<MidiAudioRenderer> {
	const worker = createWorker();
	const broker = new WorkerRequestBroker({ timeoutMs: 30_000 });
	let sequence = 0;
	worker.addEventListener('message', ({ data: response }) => {
		if (response.error) broker.reject(response.id, new Error(response.error));
		else broker.resolve(response.id, response);
	});
	worker.addEventListener('error', () => { broker.dispose(new Error('MIDI synthesis worker failed.')); worker.terminate(); });
	worker.addEventListener('messageerror', () => { broker.dispose(new Error('MIDI synthesis worker message failed.')); worker.terminate(); });
	const request = <Result>(message: Omit<MidiRenderWorkerRequest, 'id'>) => {
		const id = String(++sequence);
		return broker.request<Result>({ id, post: () => worker.postMessage({ id, ...message }), onTimeout: () => { broker.dispose(); worker.terminate(); } });
	};
	try {
		if (typeof instrument !== 'string') {
			const prepared = await request<{ timeline: MidiAudioEventTimeline }>({ data, initialFrame, eventsOnly: true });
			broker.dispose(); worker.terminate();
			return openSeekableNativeRenderer(data, instrument, sampleRate, initialFrame, prepared.timeline);
		}
		const ready = await request<{ channelCount: number }>({ data, instrument, sampleRate, initialFrame });
		return { channelCount: ready.channelCount,
			render: (start, frames) => request<{ channels: Float32Array<ArrayBuffer>[] }>({ start, frames }).then(result => result.channels),
			close: async () => { broker.dispose(); worker.terminate(); },
		};
	} catch (error) { broker.dispose(); worker.terminate(); throw error; }
}

async function openSeekableNativeRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number, initialFrame: number, timeline: MidiAudioEventTimeline): Promise<MidiAudioRenderer> {
	let renderer = await openMidiAudioRenderer(data, instrument, sampleRate, initialFrame, timeline);
	let position = initialFrame;
	return { channelCount: renderer.channelCount, async render(start, frames) {
		if (start < initialFrame) throw new RangeError('MIDI read precedes its playback origin.');
		if (start < position) { await renderer.close(); renderer = await openMidiAudioRenderer(data, instrument, sampleRate, initialFrame, timeline); position = initialFrame; }
		// An export retains canonical history; live readers start at their separately cached seek origin.
		while (position < start) { const count = Math.min(1024, start - position); await renderer.render(position, count); position += count; }
		const output = await renderer.render(start, frames); position += frames; return output;
	}, close: () => renderer.close() };
}
