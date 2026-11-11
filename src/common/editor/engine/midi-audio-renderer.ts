/* SPDX-License-Identifier: AGPL-3.0-only */
import { createMidiRenderer } from './midi-synthesis.ts';
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

/** Sequential source compilation keeps every stateful instrument render isolated. */
export async function openMidiAudioRenderer(data: MidiClipData, instrument: MidiInstrument, sampleRate: number) {
	if (typeof instrument === 'string') {
		const render = createMidiRenderer(data.notes, instrument, sampleRate, data.interchange?.events);
		return { channelCount: 1, render: async (start: number, frames: number) => [render(start, frames)], close: async () => undefined };
	}
	const provider = [...providers].at(-1);
	if (!provider) throw new Error(`The native instrument ${instrument.name} requires its allowed desktop plug-in to edit or audition.`);
	const events = nativeMidiEvents(data);
	const session = await provider(instrument, sampleRate);
	let position = 0, requestedPosition = 0, cursor = 0;
	return { channelCount: session.channelCount, async render(start: number, frames: number) {
		if (start !== requestedPosition) throw new RangeError('Native instrument source rendering must be sequential.');
		const output = Array.from({ length: session.channelCount }, () => new Float32Array(frames));
		// Warm up by the reported latency once; discard those output frames for exact alignment.
		let remaining = frames + (start === 0 ? session.latencyFrames : 0);
		let written = 0;
		while (remaining > 0) {
			const count = Math.min(4096, remaining);
			const block: MidiBlockEvent[] = [];
			while (cursor < events.length && events[cursor]!.frame < position + count) {
				const event = events[cursor++]!;
				block.push({ frame: event.frame - position, data: event.data });
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

/** Keep same-sample panic provenance consistent with Standard MIDI export. */
function nativeMidiEvents(data: MidiClipData): MidiBlockEvent[] {
	const auxiliary = data.interchange?.events ?? [];
	const ordered: (MidiBlockEvent & { order: number })[] = [];
	const stops = new Map<string, number>();
	const releases = new Map<string, number>();
	for (const [index, event] of auxiliary.entries()) {
		if (event.status < 0x80 || event.status >= 0xf0 || [0x80, 0x90].includes(event.status & 0xf0)) continue;
		const order = (index + 1) / (auxiliary.length + 1);
		ordered.push({ frame: event.frame, data: [event.status, ...event.data], order });
		const key = `${event.frame}:${event.status & 15}`;
		if ((event.status & 0xf0) === 0xb0 && event.data[0] === 120 && !stops.has(key)) stops.set(key, order - 0.5 / (auxiliary.length + 1));
		if (event.releaseId) releases.set(`${event.releaseId}:${key}`, order - 0.5 / (auxiliary.length + 1));
	}
	for (const note of data.notes) {
		if (!note.velocity) continue;
		const key = `${note.startFrame}:${note.channel}`;
		const beforeStop = note.onsetStop?.kind === 'all-notes-off' ? releases.get(`${note.onsetStop.releaseId}:${key}`)
			: note.onsetStop ? stops.get(key) : undefined;
		if (note.onsetStop && beforeStop === undefined) throw new RangeError('Native MIDI instrument rendering requires the causal same-frame key-release event.');
		ordered.push({ frame: note.startFrame, data: [0x90 | note.channel, note.pitch, note.velocity], order: beforeStop ?? 2 },
			{ frame: note.onsetStop ? note.startFrame : note.startFrame + note.durationFrames,
				data: [0x80 | note.channel, note.pitch, note.releaseVelocity ?? 0], order: 1 });
	}
	return ordered.sort((a, b) => a.frame - b.frame || a.order - b.order).map(({ frame, data }) => ({ frame, data }));
}
