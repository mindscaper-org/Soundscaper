/* SPDX-License-Identifier: AGPL-3.0-only */
import { WorkerRequestBroker } from '../worker-request-broker.ts';
import { openMidiAudioRenderer } from './midi-audio-renderer.ts';
import type { MidiClipData, MidiInstrument } from '../midi-model.ts';
import type { MidiAudioRenderer } from './midi-demand-source.ts';
import type { MidiRenderWorkerRequest } from './midi-render-worker.ts';

export interface MidiRenderWorkerPort {
	postMessage(message: MidiRenderWorkerRequest): void;
	terminate(): void;
	addEventListener(type: string, listener: (event: MessageEvent) => void): void;
}

/** Browser DSP stays on a dedicated worker; native DSP already runs in its isolated host. */
export async function openThreadedMidiRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number,
	createWorker: () => MidiRenderWorkerPort = () => new Worker(new URL('./midi-render-worker-entry.ts', import.meta.url), { type: 'module', name: 'soundscaper-midi' }),
): Promise<MidiAudioRenderer> {
	if (typeof instrument !== 'string') return openSeekableNativeRenderer(data, instrument, sampleRate);
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
		const ready = await request<{ channelCount: number }>({ data, instrument, sampleRate });
		return { channelCount: ready.channelCount,
			render: (start, frames) => request<{ channels: Float32Array<ArrayBuffer>[] }>({ start, frames }).then(result => result.channels),
			close: async () => { broker.dispose(); worker.terminate(); },
		};
	} catch (error) { broker.dispose(); worker.terminate(); throw error; }
}

async function openSeekableNativeRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number): Promise<MidiAudioRenderer> {
	let renderer = await openMidiAudioRenderer(data, instrument, sampleRate);
	let position = 0;
	return { channelCount: renderer.channelCount, async render(start, frames) {
		if (start < position) { await renderer.close(); renderer = await openMidiAudioRenderer(data, instrument, sampleRate); position = 0; }
		// Replay retained controller/voice history on a cold seek; never run plug-in code on the UI thread.
		while (position < start) { const count = Math.min(1024, start - position); await renderer.render(position, count); position += count; }
		const output = await renderer.render(start, frames); position += frames; return output;
	}, close: () => renderer.close() };
}
