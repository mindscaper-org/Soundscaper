/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';
import {
	MIDI_FILE_MAX_BYTES, MIDI_FILE_MAX_EVENTS, MIDI_FILE_MAX_TRACKS,
	midiFileInteger, midiFileSampleRate, validateMidiFileDocument,
	type MidiFileDocument, type MidiFileEvent, type MidiFileReadOptions, type MidiFileSignature, type MidiFileTempo,
} from './midi-file-types.ts';
import { createMidiFileWriteClock } from './midi-file-write-clock.ts';
import { midiFileNoteReleaseId, midiFileNoteReleases } from './midi-file-note-releases.ts';
import { createMidiFileNoteOrderGuard } from './midi-file-note-order.ts';
import { decodeMidiFileText } from './midi-file-text.ts';
import { roundRational } from './timeline-time.ts';
import { assertMidiFileProgramOrder, assertMidiFileWrittenProgramOrder, midiFileNoteDestinations } from './midi-file-destinations.ts';
import { midiPortEvents, midiTextChannelEvents, type MidiPortTickEvent as TickEvent } from './midi-file-port-events.ts';

// Independent implementation of Standard MIDI Files 1.0 (MIDI Association RP-001).
// https://midi.org/standard-midi-files
interface TickTrack { readonly name: string; readonly events: readonly TickEvent[]; readonly endTick: number; readonly named: boolean }
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
	let named = false;
	let textChannel: number | null = null;
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
			textChannel = null;
			events.push({ tick, status, data });
		} else {
			runningStatus = 0;
			if (status !== 255 && status !== 240 && status !== 247) throw new RangeError('Unsupported MIDI system status.');
			const metaType = status === 255 ? reader.byte() : undefined;
			const data = [...reader.read(reader.variable())];
			if (metaType === 32 && data.length === 1 && data[0]! <= 15) textChannel = data[0]!;
			if (metaType === 47) {
				if (data.length) throw new RangeError('Invalid MIDI end-of-track event.');
				if (reader.position !== bytes.length) throw new RangeError('MIDI track contains data after end-of-track.');
				return { name, events, endTick: tick, named };
			}
			if (metaType === 3) {
				if (textChannel !== null) throw new RangeError('A channel-scoped MIDI track name cannot retain its association. Use an unscoped track name.');
				name = decodeMidiFileText(Uint8Array.from(data)); named = true;
			} else if (status !== 247 || data.length) events.push({ tick, status, data, ...(metaType === undefined ? {} : { metaType }) });
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
	const tickDenominator = BigInt(division) * 1_000_000n;
	const tickSegments = [{ tick: 0, numerator: 0n, sampleMicros: 500_000n * BigInt(sampleRate) }];
	for (const event of tempoEvents) {
		if (event.data.length !== 3) throw new RangeError('Invalid MIDI tempo event.');
		const micros = event.data[0]! * 65_536 + event.data[1]! * 256 + event.data[2]!;
		if (!micros) throw new RangeError('Invalid zero MIDI tempo.');
		const previous = tickSegments[tickSegments.length - 1]!;
		const numerator = previous.numerator + BigInt(event.tick - previous.tick) * previous.sampleMicros;
		const frame = division & 0x8000 ? smpteFrame(event.tick, division, sampleRate)
			: roundRational(numerator, tickDenominator, 'point');
		const segment = { tick: event.tick, numerator, sampleMicros: BigInt(micros) * BigInt(sampleRate) };
		const tempo = { frame, bpm: 60_000_000 / micros };
		if (segment.tick === previous.tick) { tickSegments[tickSegments.length - 1] = segment; tempos[tempos.length - 1] = tempo; }
		else { tickSegments.push(segment); tempos.push(tempo); }
	}
	const tickToFrame = (tick: number): number => {
		if (division & 0x8000) return smpteFrame(tick, division, sampleRate);
		let low = 0;
		let high = tickSegments.length;
		while (low + 1 < high) { const middle = Math.floor((low + high) / 2); if (tickSegments[middle]!.tick <= tick) low = middle; else high = middle; }
		const segment = tickSegments[low]!;
		return roundRational(segment.numerator + BigInt(tick - segment.tick) * segment.sampleMicros, tickDenominator, 'point');
	};
	const signatures: MidiFileSignature[] = [];
	const releases = midiFileNoteReleases(tracks, tickToFrame);
	assertMidiFileProgramOrder(tracks, tickToFrame, releases, () => createMidiFileWriteClock(tempos, sampleRate, 9600).tick);
	const result = tracks.map((track, trackIndex) => {
		const notes: MidiNote[] = [];
		const events: MidiFileEvent[] = [];
		let noteIndex = 0;
		const hasTextChannels = track.events.some(event => event.metaType === 32 && event.data.length === 1 && event.data[0]! <= 15);
		let textChannel: number | null = null;
		const hasPorts = track.events.some(event => event.metaType === 0x21 && event.data.length === 1);
		let port = 0;
		const finish = (start: TickEvent, endTick: number, releaseVelocity = 0, allSoundOff = false,
			allNotesOff?: Readonly<{ id: string; soundEndTick: number | null }>): void => {
			const startFrame = tickToFrame(start.tick);
			const endFrame = tickToFrame(endTick);
			const stop = allNotesOff ? { kind: 'all-notes-off' as const, frame: startFrame, channel: start.status & 15,
				releaseId: allNotesOff.id, soundEndFrame: allNotesOff.soundEndTick === null ? null : tickToFrame(allNotesOff.soundEndTick) }
				: allSoundOff ? { kind: 'all-sound-off' as const, frame: startFrame, channel: start.status & 15 } : null;
			notes.push({ id: `midi-${trackIndex}-${noteIndex++}`, pitch: start.data[0]!, channel: start.status & 15,
				velocity: start.data[1]!, startFrame, durationFrames: Math.max(1, endFrame - startFrame),
				...(releaseVelocity ? { releaseVelocity } : {}),
				...(hasPorts ? { midiPort: port } : {}),
				...(stop && endFrame === startFrame ? { onsetStop: stop } : {}) });
		};
		for (const [order, event] of track.events.entries()) {
			const type = event.status & 240;
			if (event.status < 240) textChannel = null;
			else if (event.metaType === 32 && event.data.length === 1 && event.data[0]! <= 15) textChannel = event.data[0]!;
			if (event.metaType === 0x21 && event.data.length === 1) port = event.data[0]!;
			if (event.metaType === 81) continue;
			if (event.metaType === 88) {
				if (event.data.length !== 4 || event.data[1]! > 30 || !event.data[0]) throw new RangeError('Invalid MIDI time signature.');
				signatures.push({ frame: tickToFrame(event.tick), numerator: event.data[0]!, denominator: 2 ** event.data[1]!,
					...(event.data[2] === 24 ? {} : { clocksPerMetronomeClick: event.data[2]! }),
					...(event.data[3] === 8 ? {} : { notated32ndNotesPerQuarter: event.data[3]! }) });
			} else if (type === 128 || type === 144) {
				if (type === 144 && event.data[1]) {
					const release = releases.get(event);
					finish(event, release?.tick ?? track.endTick, release?.velocity ?? 0, release?.allSoundOff, release?.allNotesOff);
				}
			} else {
				events.push({ frame: tickToFrame(event.tick), status: event.status, data: event.data, ...(event.metaType === undefined ? {} : { metaType: event.metaType }),
					...(type === 176 && [123, 124, 125, 126, 127].includes(event.data[0]!) ? { releaseId: midiFileNoteReleaseId(trackIndex, order) } : {}),
					...(hasTextChannels && event.status === 255 && [1, 2, 4, 5, 6, 7, 8, 9].includes(event.metaType ?? -1) ? { textChannel } : {}),
					...(event.metaType === 0x54 ? { conductor: format === 0 || trackIndex === 0 } : {}) });
			}
		}
		notes.sort((a, b) => a.startFrame - b.startFrame || a.pitch - b.pitch);
		return { name: track.name, notes, durationFrames: tickToFrame(track.endTick), ...(events.length ? { events } : {}),
			...(!track.named && track.events.length && track.events.every(event => event.metaType === 81 || event.metaType === 88) ? { conductorOnly: true as const } : {}),
			...(notes.length ? { noteDestinations: midiFileNoteDestinations(track.events) } : {}) };
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
	return roundRational(BigInt(tick) * BigInt(sampleRate) * (code === 29 ? 1001n : 1n),
		BigInt(code === 29 ? 30_000 : code) * BigInt(ticksPerFrame), 'point');
}

function variableBytes(value: number): number[] {
	midiFileInteger(value, 0, 0x0fffffff, 'delta time');
	const result = [value & 127];
	while ((value = Math.floor(value / 128)) > 0) result.unshift((value & 127) | 128);
	return result;
}

function trackBytes(events: readonly TickEvent[], endTick: number | undefined, paddingBudget: { remaining: number },
	observe?: (event: TickEvent) => void): number[] {
	const result: number[] = [];
	let previous = 0;
	let multipartSysex = false;
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
	for (const event of midiTextChannelEvents(midiPortEvents([...events].sort((a, b) => a.tick - b.tick || eventOrder(a) - eventOrder(b)), paddingBudget), paddingBudget)) {
		observe?.(event);
		if (event.status === 240) {
			if (multipartSysex) throw new RangeError('MIDI export interrupts an incomplete multipart System Exclusive message.');
			multipartSysex = event.data.at(-1) !== 247;
		} else if (event.status === 247 && multipartSysex && event.data.at(-1) === 247) multipartSysex = false;
		appendDelta(event.tick);
		result.push(event.status);
		if (event.status === 255) result.push(event.metaType!);
		if (event.status >= 240) result.push(...variableBytes(event.data.length));
		for (const byte of event.data) result.push(byte);
		if (result.length > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI export exceeds the 16 MiB limit.');
	}
	if (multipartSysex) throw new RangeError('MIDI export ends with an incomplete multipart System Exclusive message.');
	appendDelta(Math.max(previous, endTick ?? previous));
	result.push(255, 47, 0);
	return [77, 84, 114, 107, ...uint32Bytes(result.length), ...result];
}

function eventOrder(event: TickEvent): number {
	if (event.order !== undefined) return event.order;
	const type = event.status & 240;
	// Match the frame renderer: apply setup first, release old keys, then retrigger.
	return type === 128 ? 1 : type === 144 ? 2 : 0;
}

function uint32Bytes(value: number): number[] { return [value >>> 24, value >>> 16 & 255, value >>> 8 & 255, value & 255]; }

export function writeMidiFile(document: MidiFileDocument): Uint8Array<ArrayBuffer> {
	validateMidiFileDocument(document);
	const needsConductor = document.tempos.length > 0 || document.signatures.length > 0
		|| document.tracks.some(track => track.events?.some(event => event.status === 255 && event.metaType === 0x54));
	const separateConductor = needsConductor && document.tracks.length < MIDI_FILE_MAX_TRACKS;
	const offsets = conductorSmpteOffsets(document, separateConductor);
	let eventCount = document.tempos.length + document.signatures.length + offsets.length + (separateConductor ? 1 : 0);
	for (const track of document.tracks) {
		eventCount += track.notes.length * 2 + 2;
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) eventCount += 1;
		for (const event of track.events ?? []) if (writtenAuxiliaryEvent(event)) eventCount += 1;
	}
	if (eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('MIDI export exceeds the reader event limit.');
	const paddingBudget = { remaining: MIDI_FILE_MAX_EVENTS - eventCount };
	const division = 9600;
	const clock = createMidiFileWriteClock(document.tempos, document.sampleRate, division);
	const tick = clock.tick;
	assertMidiFileWrittenProgramOrder(document, tick);
	const conductor: TickEvent[] = clock.tempos.map(tempo => ({ tick: tempo.tick, status: 255, metaType: 81, data: uint32Bytes(tempo.micros).slice(1) }));
	for (const signature of document.signatures) conductor.push({ tick: tick(signature.frame), status: 255, metaType: 88,
		data: [signature.numerator, Math.log2(signature.denominator), signature.clocksPerMetronomeClick ?? 24, signature.notated32ndNotesPerQuarter ?? 8] });
	for (const offset of offsets) conductor.push({ ...offset, tick: 0 });
	const count = document.tracks.length + (separateConductor ? 1 : 0);
	const bytes = [77, 84, 104, 100, 0, 0, 0, 6, 0, 1, count >> 8, count & 255, division >> 8, division & 255];
	if (separateConductor) for (const byte of trackBytes(conductor, undefined, paddingBudget)) bytes.push(byte);
	for (const [index, track] of document.tracks.entries()) {
		const noteOrder = createMidiFileNoteOrderGuard();
		const events: TickEvent[] = [{ tick: 0, status: 255, metaType: 3, data: [...textEncoder.encode(track.name)] }];
		const auxiliary = (track.events ?? []).filter(writtenAuxiliaryEvent);
		const stops = new Map<string, number>();
		const keyReleases = new Map<string, number>();
		let port = 0;
		for (const [position, event] of auxiliary.entries()) {
			if (event.status === 255 && event.metaType === 0x21 && event.data.length === 1) port = event.data[0]!;
			const order = (position + 1) / (auxiliary.length + 1);
			events.push({ ...event, tick: tick(event.frame), order });
			if ((event.status & 240) === 176 && event.data[0] === 120) {
				const key = `${event.frame}:${event.status & 15}:${port}`;
				if (!stops.has(key)) stops.set(key, order - 0.5 / (auxiliary.length + 1));
			} else if (event.releaseId !== undefined) {
				const key = `${event.releaseId}:${event.frame}:${event.status & 15}:${port}`;
				keyReleases.set(key, keyReleases.has(key) ? Number.NaN : order - 0.5 / (auxiliary.length + 1));
			}
		}
		if (!separateConductor && index === 0) for (const event of conductor) events.push(event);
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) {
			events.push({ tick: 0, status: 192, data: [track.program] });
		}
		for (const note of track.notes) {
			if (note.velocity === 0) throw new RangeError('A zero-velocity MIDI note cannot be exported as a sounding note. Raise its velocity or delete it.');
			const identity = `${note.startFrame}:${note.channel}:${note.midiPort ?? 0}`;
			const stopOrder = note.onsetStop?.kind === 'all-notes-off' ? keyReleases.get(`${note.onsetStop.releaseId}:${identity}`)
				: note.onsetStop ? stops.get(identity) : undefined;
			if (note.onsetStop && (stopOrder === undefined || !Number.isFinite(stopOrder))) throw new RangeError('MIDI export cannot preserve a same-frame panic without its unambiguous local causal event. Save the native project.');
			const on = { tick: tick(note.startFrame), status: 144 | note.channel, data: [note.pitch, note.velocity], midiPort: note.midiPort, ...(stopOrder === undefined ? {} : { order: stopOrder }) };
			const off = { tick: note.onsetStop ? tick(note.startFrame) : Math.max(tick(note.startFrame) + 1, tick(note.startFrame + note.durationFrames)),
				status: 128 | note.channel, data: [note.pitch, note.releaseVelocity ?? 0], midiPort: note.midiPort };
			noteOrder.register(on, off);
			events.push(on, off);
		}
		for (const byte of trackBytes(events, track.durationFrames === undefined ? undefined : tick(track.durationFrames), paddingBudget, noteOrder.observe)) bytes.push(byte);
		if (bytes.length > MIDI_FILE_MAX_BYTES) throw new RangeError('MIDI export exceeds the 16 MiB limit.');
	}
	return Uint8Array.from(bytes);
}

function writtenAuxiliaryEvent(event: MidiFileEvent): boolean {
	return !(event.status === 255 && ([3, 47, 81, 88].includes(event.metaType!) || event.metaType === 0x54 && event.conductor === true));
}

/** Format 1 gives SMPTE offsets meaning only on its actual tempo-map track. */
function conductorSmpteOffsets(document: MidiFileDocument, separateConductor: boolean): readonly MidiFileEvent[] {
	let retained: MidiFileEvent | undefined;
	for (const [index, track] of document.tracks.entries()) for (const event of track.events ?? []) {
		if (event.status !== 255 || event.metaType !== 0x54) continue;
		if (event.conductor === undefined) throw new RangeError('MIDI SMPTE Offset has ambiguous conductor provenance. Reimport the original MIDI file.');
		if (!event.conductor) {
			if (!separateConductor && index === 0) throw new RangeError('MIDI export cannot activate an ignored SMPTE Offset on its tempo-map track.');
			continue;
		}
		if (event.frame !== 0) throw new RangeError('MIDI export cannot relocate an active SMPTE Offset from its original start.');
		if (retained && JSON.stringify(retained.data) !== JSON.stringify(event.data)) throw new RangeError('MIDI export has conflicting active SMPTE Offsets.');
		retained ??= event;
	}
	return retained ? [retained] : [];
}
