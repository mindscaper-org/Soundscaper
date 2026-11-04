/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';
import {
	MIDI_FILE_MAX_BYTES, MIDI_FILE_MAX_EVENTS, MIDI_FILE_MAX_TRACKS,
	midiFileInteger, midiFileSampleRate, validateMidiFileDocument,
	type MidiFileDocument, type MidiFileEvent, type MidiFileReadOptions, type MidiFileSignature, type MidiFileTempo,
} from './midi-file-types.ts';
import { createMidiTempoTimeline } from './midi-file-timing.ts';

// Independent implementation of Standard MIDI Files 1.0 (MIDI Association RP-001).
// https://midi.org/standard-midi-files
interface TickEvent { readonly tick: number; readonly status: number; readonly data: readonly number[]; readonly metaType?: number }
interface TickTrack { readonly name: string; readonly events: readonly TickEvent[]; readonly endTick: number }
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

class MidiReader {
	position = 0;
	constructor(readonly bytes: Uint8Array) {}
	read(length: number): Uint8Array {
		if (length > this.bytes.length - this.position) throw new RangeError('Truncated MIDI file.');
		const data = this.bytes.subarray(this.position, this.position + length);
		this.position += length;
		return data;
	}
	byte(): number { return this.read(1)[0]!; }
	uint16(): number { return this.byte() * 256 + this.byte(); }
	uint32(): number { return this.uint16() * 65_536 + this.uint16(); }
	variable(): number {
		let value = 0;
		for (let count = 0; count < 4; count += 1) {
			const byte = this.byte();
			value = value * 128 + (byte & 127);
			if (byte < 128) return value;
		}
		throw new RangeError('Invalid MIDI variable-length delta time.');
	}
}

function parseTrack(bytes: Uint8Array, index: number, budget: { count: number }): TickTrack {
	const reader = new MidiReader(bytes);
	const events: TickEvent[] = [];
	let tick = 0;
	let runningStatus = 0;
	let name = `MIDI ${index + 1}`;
	while (reader.position < bytes.length) {
		if (++budget.count > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI file contains too many events.');
		tick += reader.variable();
		midiFileInteger(tick, 0, Number.MAX_SAFE_INTEGER, 'event tick');
		let status = reader.byte();
		if (status < 128) {
			if (!runningStatus) throw new RangeError('Invalid MIDI running status.');
			reader.position -= 1;
			status = runningStatus;
		}
		if (status < 240) {
			runningStatus = status;
			const type = status & 240;
			const data = [...reader.read(type === 192 || type === 208 ? 1 : 2)];
			if (data.some(byte => byte > 127)) throw new RangeError('Invalid MIDI channel data byte.');
			events.push({ tick, status, data });
		} else {
			runningStatus = 0;
			if (status !== 255 && status !== 240 && status !== 247) throw new RangeError('Unsupported MIDI system status.');
			const metaType = status === 255 ? reader.byte() : undefined;
			const data = [...reader.read(reader.variable())];
			if (metaType === 47) {
				if (data.length) throw new RangeError('Invalid MIDI end-of-track event.');
				if (reader.position !== bytes.length) throw new RangeError('MIDI track contains data after end-of-track.');
				return { name, events, endTick: tick };
			}
			if (metaType === 3) name = textDecoder.decode(Uint8Array.from(data));
			else if (status !== 247 || data.length) events.push({ tick, status, data, ...(metaType === undefined ? {} : { metaType }) });
		}
	}
	throw new RangeError('MIDI track is missing its end-of-track event.');
}

export function parseMidiFile(input: Uint8Array | ArrayBuffer, options: MidiFileReadOptions = {}): MidiFileDocument {
	const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
	if (bytes.length > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI file exceeds the 16 MiB import limit.');
	const sampleRate = midiFileSampleRate(options.sampleRate);
	const reader = new MidiReader(bytes);
	if (textDecoder.decode(reader.read(4)) !== 'MThd') throw new RangeError('Not a Standard MIDI file.');
	const headerSize = reader.uint32();
	if (headerSize < 6) throw new RangeError('Invalid MIDI header length.');
	const format = reader.uint16();
	if (format !== 0 && format !== 1) throw new RangeError(`MIDI format ${format} is unsupported; use type 0 or type 1.`);
	const count = reader.uint16();
	midiFileInteger(count, 1, MIDI_FILE_MAX_TRACKS, 'track count');
	if (format === 0 && count !== 1) throw new RangeError('MIDI type 0 must contain exactly one track.');
	const division = reader.uint16();
	if (!division) throw new RangeError('Invalid MIDI time division.');
	if (division & 0x8000) smpteFrame(0, division, sampleRate);
	reader.read(headerSize - 6);
	const tracks: TickTrack[] = [];
	const budget = { count: 0 };
	while (reader.position < bytes.length) {
		const kind = textDecoder.decode(reader.read(4));
		const chunk = reader.read(reader.uint32());
		if (kind === 'MTrk') {
			if (tracks.length >= count) throw new RangeError('MIDI file contains more tracks than its header declares.');
			tracks.push(parseTrack(chunk, tracks.length, budget));
		}
	}
	if (tracks.length !== count) throw new RangeError('Truncated MIDI track collection.');
	const tempoEvents = tracks.flatMap(track => track.events).filter(event => event.metaType === 81).sort((a, b) => a.tick - b.tick);
	const tempos: MidiFileTempo[] = [{ frame: 0, bpm: 120 }];
	const tickSegments = [{ tick: 0, frame: 0, bpm: 120 }];
	for (const event of tempoEvents) {
		if (event.data.length !== 3) throw new RangeError('Invalid MIDI tempo event.');
		const micros = event.data[0]! * 65_536 + event.data[1]! * 256 + event.data[2]!;
		if (!micros) throw new RangeError('Invalid zero MIDI tempo.');
		const previous = tickSegments[tickSegments.length - 1]!;
		const frame = division & 0x8000 ? smpteFrame(event.tick, division, sampleRate)
			: previous.frame + (event.tick - previous.tick) / division * 60 / previous.bpm * sampleRate;
		const segment = { tick: event.tick, frame, bpm: 60_000_000 / micros };
		if (segment.tick === previous.tick) { tickSegments[tickSegments.length - 1] = segment; tempos[tempos.length - 1] = { frame: Math.round(frame), bpm: segment.bpm }; }
		else { tickSegments.push(segment); tempos.push({ frame: Math.round(frame), bpm: segment.bpm }); }
	}
	const tickToFrame = (tick: number): number => {
		if (division & 0x8000) return Math.round(smpteFrame(tick, division, sampleRate));
		let low = 0;
		let high = tickSegments.length;
		while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (tickSegments[middle]!.tick <= tick) low = middle; else high = middle; }
		const segment = tickSegments[low]!;
		return Math.round(segment.frame + (tick - segment.tick) / division * 60 / segment.bpm * sampleRate);
	};
	const signatures: MidiFileSignature[] = [];
	const result = tracks.map((track, trackIndex) => {
		const notes: MidiNote[] = [];
		const events: MidiFileEvent[] = [];
		const active = new Map<number, TickEvent[]>();
		let noteIndex = 0;
		const finish = (start: TickEvent, endTick: number, releaseVelocity = 0): void => {
			const startFrame = tickToFrame(start.tick);
			notes.push({ id: `midi-${trackIndex}-${noteIndex++}`, pitch: start.data[0]!, channel: start.status & 15,
				velocity: start.data[1]!, startFrame, durationFrames: Math.max(1, tickToFrame(endTick) - startFrame),
				...(releaseVelocity ? { releaseVelocity } : {}) });
		};
		for (const event of track.events) {
			const type = event.status & 240;
			if (event.metaType === 81) continue;
			if (event.metaType === 88) {
				if (event.data.length !== 4 || event.data[1]! > 30 || !event.data[0]) throw new RangeError('Invalid MIDI time signature.');
				signatures.push({ frame: tickToFrame(event.tick), numerator: event.data[0]!, denominator: 2 ** event.data[1]! });
			} else if (type === 128 || type === 144) {
				const key = (event.status & 15) * 128 + event.data[0]!;
				const stack = active.get(key) ?? [];
				if (type === 144 && event.data[1]) { stack.push(event); active.set(key, stack); }
				else { const start = stack.shift(); if (start) finish(start, event.tick, type === 128 ? event.data[1]! : 64); }
			} else {
				if (type === 176 && [120, 123, 124, 125, 126, 127].includes(event.data[0]!)) {
					for (const [key, stack] of active) if (Math.floor(key / 128) === (event.status & 15)) {
						for (const start of stack) finish(start, event.tick);
						active.delete(key);
					}
				}
				events.push({ frame: tickToFrame(event.tick), status: event.status, data: event.data, ...(event.metaType === undefined ? {} : { metaType: event.metaType }) });
			}
		}
		for (const stack of active.values()) for (const start of stack) finish(start, track.endTick);
		notes.sort((a, b) => a.startFrame - b.startFrame || a.pitch - b.pitch);
		return { name: track.name, notes, durationFrames: tickToFrame(track.endTick), ...(events.length ? { events } : {}) };
	});
	if (!signatures.some(signature => signature.frame === 0)) signatures.unshift({ frame: 0, numerator: 4, denominator: 4 });
	const document = { sampleRate, tracks: result, tempos, signatures: signatures.sort((a, b) => a.frame - b.frame) };
	validateMidiFileDocument(document);
	return document;
}

function smpteFrame(tick: number, division: number, sampleRate: number): number {
	const code = 256 - (division >> 8);
	const ticksPerFrame = division & 255;
	if (![24, 25, 29, 30].includes(code) || !ticksPerFrame) throw new RangeError('Invalid MIDI SMPTE time division.');
	return tick / ((code === 29 ? 30_000 / 1001 : code) * ticksPerFrame) * sampleRate;
}

function variableBytes(value: number): number[] {
	midiFileInteger(value, 0, 0x0fffffff, 'delta time');
	const result = [value & 127];
	while ((value = Math.floor(value / 128)) > 0) result.unshift((value & 127) | 128);
	return result;
}

function trackBytes(events: readonly TickEvent[], endTick: number | undefined, paddingBudget: { remaining: number }): number[] {
	const result: number[] = [];
	let previous = 0;
	const appendDelta = (tick: number): void => {
		midiFileInteger(tick, 0, Number.MAX_SAFE_INTEGER, 'event tick');
		while (tick - previous > 0x0fffffff) {
			if (paddingBudget.remaining-- <= 0) throw new RangeError('MIDI export exceeds the reader event limit.');
			// An empty F7 escape transmits no MIDI bytes; it only advances the SMF clock.
			result.push(...variableBytes(0x0fffffff), 247, 0);
			previous += 0x0fffffff;
		}
		result.push(...variableBytes(tick - previous));
		previous = tick;
	};
	for (const event of [...events].sort((a, b) => a.tick - b.tick || eventOrder(a) - eventOrder(b))) {
		appendDelta(event.tick);
		result.push(event.status);
		if (event.status === 255) result.push(event.metaType!);
		if (event.status >= 240) result.push(...variableBytes(event.data.length));
		for (const byte of event.data) result.push(byte);
		if (result.length > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI export exceeds the 16 MiB limit.');
	}
	appendDelta(Math.max(previous, endTick ?? previous));
	result.push(255, 47, 0);
	return [77, 84, 114, 107, ...uint32Bytes(result.length), ...result];
}

function eventOrder(event: TickEvent): number {
	const type = event.status & 240;
	return type === 128 ? 0 : type === 144 ? 2 : 1;
}

function uint32Bytes(value: number): number[] { return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255]; }

export function writeMidiFile(document: MidiFileDocument): Uint8Array<ArrayBuffer> {
	validateMidiFileDocument(document);
	const separateConductor = document.tracks.length < MIDI_FILE_MAX_TRACKS;
	let eventCount = document.tempos.length + document.signatures.length + (separateConductor ? 1 : 0);
	for (const track of document.tracks) {
		eventCount += track.notes.length * 2 + 2;
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) eventCount += 1;
		for (const event of track.events ?? []) if (writtenAuxiliaryEvent(event)) eventCount += 1;
	}
	if (eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI export exceeds the reader event limit.');
	const paddingBudget = { remaining: MIDI_FILE_MAX_EVENTS - eventCount };
	const division = 9600;
	const quantizedTempos = document.tempos.map(tempo => ({ ...tempo, bpm: 60_000_000 / Math.round(60_000_000 / tempo.bpm) }));
	const timing = createMidiTempoTimeline(quantizedTempos, document.sampleRate);
	const tick = (frame: number): number => Math.round(timing.frameToBeat(frame) * division);
	const conductor: TickEvent[] = document.tempos.map(tempo => {
		const micros = midiFileInteger(Math.round(60_000_000 / tempo.bpm), 1, 0xffffff, 'tempo');
		return { tick: tick(tempo.frame), status: 255, metaType: 81, data: uint32Bytes(micros).slice(1) };
	});
	for (const signature of document.signatures) conductor.push({ tick: tick(signature.frame), status: 255, metaType: 88,
		data: [signature.numerator, Math.log2(signature.denominator), 24, 8] });
	const count = document.tracks.length + (separateConductor ? 1 : 0);
	const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, 1, count >> 8, count & 255, division >> 8, division & 255];
	if (separateConductor) for (const byte of trackBytes(conductor, undefined, paddingBudget)) bytes.push(byte);
	for (const [index, track] of document.tracks.entries()) {
		const events: TickEvent[] = [{ tick: 0, status: 255, metaType: 3, data: [...textEncoder.encode(track.name)] }];
		if (!separateConductor && index === 0) for (const event of conductor) events.push(event);
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) {
			events.push({ tick: 0, status: 192, data: [track.program] });
		}
		for (const note of track.notes) {
			if (note.velocity === 0) throw new RangeError('A zero-velocity MIDI note cannot be exported as a sounding note. Raise its velocity or delete it.');
			events.push({ tick: tick(note.startFrame), status: 144 | note.channel, data: [note.pitch, note.velocity] });
			events.push({ tick: Math.max(tick(note.startFrame) + 1, tick(note.startFrame + note.durationFrames)), status: 128 | note.channel, data: [note.pitch, note.releaseVelocity ?? 0] });
		}
		for (const event of track.events ?? []) {
			if (!writtenAuxiliaryEvent(event)) continue;
			events.push({ ...event, tick: tick(event.frame) });
		}
		for (const byte of trackBytes(events, track.durationFrames === undefined ? undefined : tick(track.durationFrames), paddingBudget)) bytes.push(byte);
		if (bytes.length > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI export exceeds the 16 MiB limit.');
	}
	return Uint8Array.from(bytes);
}

function writtenAuxiliaryEvent(event: MidiFileEvent): boolean { return !(event.status === 255 && [3, 47, 81, 88].includes(event.metaType!)); }
