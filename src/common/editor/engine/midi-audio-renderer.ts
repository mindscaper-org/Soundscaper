/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiRenderer } from './midi-synthesis.ts';
import { compileMidiAudioTimeline, type MidiAudioEventTimeline } from './midi-audio-events.ts';
import type { MidiClipData, MidiInstrument } from '../midi-model.ts';
import type { MidiNativeInstrument } from '../midi-native-instrument.ts';

export interface MidiBlockEvent { readonly frame: number; readonly data: readonly number[] }
export interface MidiInstrumentSession {
	readonly channelCount: number;
	readonly latencyFrames: number;
	process(frames: number, events: readonly MidiBlockEvent[]): Promise<Float32Array<ArrayBuffer>[]>;
	close(): Promise<void>;
}
type Provider = (instrument: MidiNativeInstrument, sampleRate: number) => Promise<MidiInstrumentSession>;
const providers = new Set<Provider>();
export function registerMidiInstrumentProvider(provider: Provider): () => void {
	providers.add(provider);
	return () => { providers.delete(provider); };
}
export async function openMidiInstrumentSession(instrument: MidiNativeInstrument, sampleRate: number): Promise<MidiInstrumentSession> {
	const provider = [...providers].at(-1);
	if (!provider) throw new Error(`The native instrument ${instrument.name} requires its allowed desktop plug-in to edit or audition.`);
	return provider(instrument, sampleRate);
}

/** Sequential source compilation keeps every stateful instrument render isolated. */
export async function openMidiAudioRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number, initialFrame = 0, prepared?: MidiAudioEventTimeline) {
	if (instrument === 'libadlmidi' || instrument === 'fluidsynth') {
		const { openMidiLibraryRenderer } = await import('./midi-library-renderer.ts');
		return openMidiLibraryRenderer(data, async () => instrument === 'libadlmidi'
			? (await import('./midi-adlmidi.ts')).openAdlMidi(sampleRate)
			: (await import('./midi-fluidsynth.ts')).openFluidSynth(sampleRate), initialFrame);
	}
	if (typeof instrument === 'string') {
		const render = createMidiRenderer(data.notes, instrument, sampleRate, data.interchange?.events);
		return { channelCount: 1, render: async (start: number, frames: number) => [render(start, frames)], close: async () => undefined };
	}
	const events = prepared ?? compileMidiAudioTimeline(data, initialFrame);
	const session = await openMidiInstrumentSession(instrument, sampleRate);
	let position = 0, requestedPosition = initialFrame, cursor = 0;
	return { channelCount: session.channelCount, async render(start: number, frames: number) {
		if (start !== requestedPosition) throw new RangeError('Native instrument source rendering must be sequential.');
		const output = Array.from({ length: session.channelCount }, () => new Float32Array(frames));
		// Warm up by the reported latency once; discard those output frames for exact alignment.
		let remaining = frames + (start === initialFrame ? session.latencyFrames : 0);
		let written = 0;
		while (remaining > 0) {
			const count = Math.min(4096, remaining);
			const block: MidiBlockEvent[] = [];
			while (cursor < events.frames.length && events.frames[cursor]! < position + count) {
				const packed = events.messages[cursor]!, size = packed >>> 24;
				block.push({ frame: events.frames[cursor++]! - position, data: [packed & 255, packed >>> 8 & 255, packed >>> 16 & 255].slice(0, size) });
			}
			const planes = await session.process(count, block);
			if (planes.length !== session.channelCount || planes.some(plane => plane.length !== count || plane.some(value => !Number.isFinite(value)))) {
				throw new Error('Native instrument returned invalid PCM.');
			}
			const skip = Math.min(count, Math.max(0, session.latencyFrames - position));
			for (let channel = 0; channel < planes.length; channel++) output[channel]!.set(planes[channel]!.subarray(skip), written);
			written += count - skip; position += count; remaining -= count;
		}
		requestedPosition += frames;
		return output;
	}, close: () => session.close() };
}
