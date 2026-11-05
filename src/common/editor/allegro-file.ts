/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MidiNote } from './midi-model.ts';
import {
	MIDI_FILE_MAX_BYTES, MIDI_FILE_MAX_EVENTS, MIDI_FILE_MAX_TRACKS,
	midiFileInteger, midiFileSampleRate, validateMidiFileDocument,
	type MidiFileDocument, type MidiFileEvent, type MidiFileReadOptions, type MidiFileSignature, type MidiFileTempo,
} from './midi-file-types.ts';
import { createMidiTempoTimeline } from './midi-file-timing.ts';
import { allegroDuration, allegroNumber, allegroPitch, allegroString, allegroTokens, allegroVelocity, allegroTempoDiscoveryPlan, allegroTimeField, type AllegroTempoDiscoveryPlan } from './allegro-file-fields.ts';
import { allegroAttributeToEvent, allegroEventFields, assertAllegroGlobalTextChannel } from './allegro-file-events.ts';
import { offsetAllegroFrame, offsetAllegroNotes, offsetAllegroTiming } from './allegro-file-offset.ts';
import { allegroTempoDeclarations, type AllegroBeatAnchor, type AllegroTempoDeclaration } from './allegro-file-anchors.ts';
import { createAllegroEventClockValidation, sameAllegroTempoClock } from './allegro-file-tempo-clock.ts';
import { allegroKeySignatures, type AllegroKeyPart } from './allegro-file-key-signatures.ts';

// Current Audacity/PortSMF Allegro grammar: numeric T/U values are seconds.
// https://github.com/rbdannenberg/portsmf/blob/master/allegrord.cpp
// This parser is independently implemented; no upstream source is copied.
// Local coordinates remain unquantized until the track offset has been applied.
interface AllegroTrack { name: string; notes: MidiNote[]; events: MidiFileEvent[] }
interface AllegroParseResult { readonly document: MidiFileDocument | null; readonly tempoDeclarations: readonly MidiFileTempo[] }

export function parseAllegroFile(text: string, options: MidiFileReadOptions = {}): MidiFileDocument {
	if (text.length > MIDI_FILE_MAX_BYTES || new TextEncoder().encode(text).length > MIDI_FILE_MAX_BYTES) throw new RangeError('Allegro file exceeds the 16 MiB import limit.');
	const sampleRate = midiFileSampleRate(options.sampleRate);
	const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
	const discovery = allegroTempoDiscoveryPlan(lines);
	const eventClock = createAllegroEventClockValidation();
	// Read the time map before notes, including files whose tempo declarations follow notes.
	const first = parseLines(lines, sampleRate, [], false, discovery, eventClock);
	const final = parseLines(lines, sampleRate, first.tempoDeclarations, true, discovery, eventClock).document;
	if (!final) throw new Error('Allegro materialization produced no document.');
	return final;
}

function parseLines(lines: readonly string[], sampleRate: number, knownTempos: readonly MidiFileTempo[], materialize: boolean, discovery: AllegroTempoDiscoveryPlan, eventClock: ReturnType<typeof createAllegroEventClockValidation>): AllegroParseResult {
	const deferBeatTempoFrames = !materialize && discovery.deferBeatTempos;
	const tracks = new Map<number, AllegroTrack>();
	const declarations: AllegroTempoDeclaration[] = [];
	const beatAnchors: AllegroBeatAnchor[] = [];
	const clockAnchors = discovery.ignoreOriginAnchors ? [] : beatAnchors;
	let declarationOrder = 0;
	const signatureParts = new Map<number, { numerator: number; denominator: number }>();
	let signatureNumerator = 4, signatureDenominator = 4;
	const keyParts: AllegroKeyPart[] = [];
	let resolvedTiming = createMidiTempoTimeline(knownTempos, sampleRate, 100);
	let timingDirty = false;
	let preparedTempos = 0, preparedAnchors = 0;
	const currentTiming = () => {
		if (timingDirty) {
			let appendable = true;
			for (let index = preparedTempos; appendable && index < declarations.length; index += 1) {
				const declaration = declarations[index]!;
				appendable = declaration.beat === undefined && resolvedTiming.appendTempo(declaration);
			}
			// Inserting a point already on the clock does not change its mapping.
			for (let index = preparedAnchors; appendable && index < clockAnchors.length; index += 1) {
				const anchor = clockAnchors[index]!;
				appendable = resolvedTiming.frameToBeat(anchor.frame) === anchor.beat;
			}
			if (!appendable) resolvedTiming = createMidiTempoTimeline(allegroTempoDeclarations(declarations, clockAnchors, sampleRate), sampleRate, 100);
			preparedTempos = declarations.length; preparedAnchors = clockAnchors.length;
			timingDirty = false;
		}
		return resolvedTiming;
	};
	const timing = {
		frameToBeat: (frame: number) => currentTiming().frameToBeat(frame),
		beatToFrame: (beat: number) => currentTiming().beatToFrame(beat),
	};
	let trackIndex = 0;
	let currentFrame = 0;
	let currentBeat: number | null = null;
	let pitch = 60;
	let velocity = 100;
	let channel = 0;
	let duration = sampleRate;
	let offset = 0;
	let offsetSeen = false;
	let noteCount = 0;
	let eventCount = 0;
	const ensureTrack = (): AllegroTrack => {
		for (let index = tracks.size; index <= trackIndex; index += 1) {
			tracks.set(index, { name: `MIDI ${index + 1}`, notes: [], events: [] });
		}
		return tracks.get(trackIndex)!;
	};
	for (const [lineIndex, raw] of lines.entries()) {
		const line = raw.trim();
		if (!line) continue;
		try {
			const header = /^#track\s+(\d+)(?:\s+(.*))?$/i.exec(line);
			if (header) {
				trackIndex = midiFileInteger(Number(header[1]), 0, MIDI_FILE_MAX_TRACKS - 1, 'Allegro track');
				if (header[2]) ensureTrack().name = header[2];
				else ensureTrack();
				continue;
			}
			const offsetMatch = /^#offset\s+(.+)$/i.exec(line);
			if (offsetMatch) {
				if (offsetSeen) throw new RangeError('Allegro offset is specified twice.');
				offsetSeen = true;
				offset = allegroNumber(offsetMatch[1]!, 'offset') * sampleRate;
				continue;
			}
			if (line.startsWith('#')) continue;
			const tokens = allegroTokens(line);
			if (!tokens.length) continue;
			if (++eventCount > MIDI_FILE_MAX_EVENTS) throw new RangeError('Allegro file contains too many events.');
			const track = ensureTrack();
			let isNote = false, pitchSpecified = false;
			let key: number | null = null;
			let next: number | null = null;
			const attributes: [string, string][] = [];
			const updates: MidiFileEvent[] = [];
			const keys: AllegroKeyPart[] = [];
			const timeTokens = tokens.filter(token => /^T/i.test(token));
			if (timeTokens.length > 1) throw new RangeError('Allegro time is specified twice.');
			for (const token of tokens) {
				const initial = token[0]!.toUpperCase();
				const value = token.slice(1);
				if (initial === 'T') {
					const position = allegroTimeField(value, sampleRate, timing, deferBeatTempoFrames && tokens.some(field => field.startsWith('-tempor:')));
					currentBeat = position.beat; currentFrame = position.frame;
				} else if (initial === '-') {
					const attribute = /^-([a-zA-Z][\da-zA-Z_]*):(.+)$/.exec(token);
					if (!attribute) throw new RangeError(`Invalid Allegro attribute: ${token}.`);
					attributes.push([attribute[1]!, attribute[2]!]);
				} else if (initial === 'V') channel = value === '-' ? -1 : allegroNumber(value, 'channel');
				else if (initial === 'L') velocity = allegroVelocity(value);
				else if (initial === 'K') key = allegroPitch(value, pitch);
				else if (initial === 'N') next = allegroDuration(value, currentFrame, timing, sampleRate);
				else if (initial === 'P' || /^[A-G]$/.test(initial)) { pitch = allegroPitch(initial === 'P' ? value : token, pitch); isNote = true; pitchSpecified = true; }
				else if (initial === 'U' || /^[SIQHW]$/.test(initial)) { duration = allegroDuration(initial === 'U' ? value : token, currentFrame, timing, sampleRate); isNote = true; }
				else throw new RangeError(`Unknown Allegro field: ${token}.`);
			}
			if (key !== null && !pitchSpecified && key < 128) { pitch = key; isNote = true; }
			if (isNote && attributes.some(([name]) => name === 'tempor' || name === 'beatr')) {
				throw new RangeError('A note sharing a conductor update cannot retain its clock evaluation order. Use separate conductor and note lines.');
			}
			if (isNote && attributes.some(([name]) => name !== 'tempor' && name !== 'beatr')) {
				throw new RangeError('Note-attached Allegro attributes cannot be retained as MIDI channel updates. Use separate update lines.');
			}
			for (const [name, value] of attributes) {
				if (name === 'tempor') {
					const bpm = allegroNumber(value, 'tempo');
					if (bpm <= 0 || bpm > 60_000_000) throw new RangeError('Invalid Allegro tempo.');
					declarations.push({ frame: currentFrame, bpm, order: declarationOrder++, ...(currentBeat === null ? {} : { beat: currentBeat }) });
					if (!knownTempos.length) timingDirty = true;
				} else if (name === 'beatr') {
					const beat = allegroNumber(value, 'beat anchor');
					beatAnchors.push({ frame: currentFrame, beat, order: declarationOrder++ });
					if (!knownTempos.length) timingDirty = true;
				} else if (name === 'timesig_numr' || name === 'timesig_denr') {
					if (name === 'timesig_numr') signatureNumerator = allegroNumber(value, 'signature numerator');
					else signatureDenominator = allegroNumber(value, 'signature denominator');
					signatureParts.set(currentFrame, { numerator: signatureNumerator, denominator: signatureDenominator });
				} else if (name === 'seqnames' || name === 'tracknames') {
					assertAllegroGlobalTextChannel(channel); track.name = allegroString(value);
				} else if (name === 'keysigi' || name === 'modea') {
					if (name === 'keysigi') keys.push({ track: trackIndex, frame: currentFrame, key: midiFileInteger(allegroNumber(value, 'key signature'), -7, 7, 'key signature') });
					else { const mode = allegroString(value); if (mode !== 'major' && mode !== 'minor') throw new RangeError('Unsupported Allegro key mode.'); keys.push({ track: trackIndex, frame: currentFrame, minor: mode === 'minor' }); }
				} else updates.push(allegroAttributeToEvent(name, value, currentFrame, channel, key));
			}
			// PortSMF prepends ordinary attributes before emitting the update list.
			// Conductor fields above retain their separate time-map processing.
			for (const [index, event] of updates.reverse().entries()) {
				track.events.push(event);
				eventClock.position(`${lineIndex}:event:${index}`, event.frame, materialize, timing);
			}
			for (const [index, part] of keys.reverse().entries()) {
				const positionId = `${lineIndex}:key:${index}`;
				keyParts.push({ ...part, positionId });
				eventClock.position(positionId, part.frame, materialize, timing, true);
			}
			if (attributes.some(([name]) => name === 'timesig_numr' || name === 'timesig_denr')) eventClock.position(`${lineIndex}:signature`, currentFrame, materialize, timing);
			if (isNote) {
				if (duration <= 0) throw new RangeError('Allegro note duration must be positive.');
				midiFileInteger(pitch, 0, 127, 'Allegro pitch (microtonal notes are unsupported)');
				midiFileInteger(channel, 0, 15, 'Allegro channel');
				midiFileInteger(Math.round(velocity), 0, 127, 'Allegro velocity');
				track.notes.push({ id: `allegro-${trackIndex}-${noteCount++}`, pitch, channel, velocity: Math.round(velocity),
					startFrame: currentFrame, durationFrames: duration });
				eventClock.position(`${lineIndex}:note:start`, currentFrame, materialize, timing);
				eventClock.position(`${lineIndex}:note:end`, currentFrame + duration, materialize, timing);
			}
			if (next !== null) currentFrame += next;
			else if (isNote) currentFrame += duration;
			if (next !== null || isNote) currentBeat = null;
		} catch (error) {
			throw new RangeError(`Allegro line ${lineIndex + 1}: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
		}
	}
	if (!tracks.size) throw new RangeError('Allegro file contains no tracks or events.');
	const keySignatures = allegroKeySignatures(keyParts);
	eventClock.completeKeys(keySignatures.flatMap(signature => signature.positionId ? [signature.positionId] : []), materialize);
	for (const signature of keySignatures) tracks.get(signature.track)!.events.push(signature.event);
	const tempoDeclarations = allegroTempoDeclarations(declarations, clockAnchors, sampleRate);
	if (!materialize) return { document: null, tempoDeclarations };
	if (!sameAllegroTempoClock(knownTempos, tempoDeclarations)) throw new RangeError('Allegro tempo expressions cannot be resolved to one stable clock. Use explicit second or beat positions.');
	eventClock.assertRetained(timing, offset);
	const tempos = tempoDeclarations.length ? [...tempoDeclarations] : [{ frame: 0, bpm: 100 }];
	if (!tempos.some(tempo => tempo.frame === 0)) tempos.unshift({ frame: 0, bpm: 100 });
	const signatures: MidiFileSignature[] = [];
	for (const [frame, parts] of [...signatureParts].sort(([left], [right]) => left - right)) {
		if (!parts.numerator || !parts.denominator) throw new RangeError('Allegro time signature requires numerator and denominator.');
		signatures.push({ frame, numerator: parts.numerator, denominator: parts.denominator });
	}
	if (!signatures.some(signature => signature.frame === 0)) signatures.unshift({ frame: 0, numerator: 4, denominator: 4 });
	const document: MidiFileDocument = {
		sampleRate, tempos: offsetAllegroTiming(tempos, offset), signatures: offsetAllegroTiming(signatures, offset),
		tracks: [...tracks.entries()].sort(([a], [b]) => a - b).map(([, track]) => ({
			name: track.name,
			notes: offsetAllegroNotes(track.notes, offset),
			...(track.events.length ? { events: track.events.map(event => ({ ...event, frame: offsetAllegroFrame(event.frame, offset, 'Allegro event time') })) } : {}),
		})),
	};
	validateMidiFileDocument(document);
	return { document, tempoDeclarations };
}

export function writeAllegroFile(document: MidiFileDocument): string {
	validateMidiFileDocument(document);
	if (document.tracks.some(track => track.notes.some(note => (note.releaseVelocity ?? 0) !== 0))) throw new RangeError('Allegro cannot preserve MIDI release velocity. Export MIDI or save the native project.');
	if (document.tracks.some(track => track.notes.some(note => note.onsetStop))) throw new RangeError('Allegro cannot preserve a note stopped by a same-frame panic. Export MIDI or save the native project.');
	if (document.tracks.some(track => track.notes.some(note => note.midiPort !== undefined))) throw new RangeError('Allegro cannot preserve authored MIDI port destinations. Export MIDI or save the native project.');
	if (document.signatures.some(signature => (signature.clocksPerMetronomeClick ?? 24) !== 24 || (signature.notated32ndNotesPerQuarter ?? 8) !== 8)) {
		throw new RangeError('MIDI metronome and notation clocks cannot be represented in Allegro.');
	}
	const lines = ['#offset 0'];
	const seconds = (frame: number): string => String(Number((frame / document.sampleRate).toFixed(10)));
	for (const [index, track] of document.tracks.entries()) {
		if (/[\r\n]/u.test(track.name) || track.name !== track.name.trim()) throw new RangeError('This track name cannot be represented verbatim in Allegro. Export MIDI instead.');
		lines.push(`#track ${index} ${track.name}`);
		if (index === 0) {
			for (const tempo of document.tempos) lines.push(`T${seconds(tempo.frame)} -tempor:${tempo.bpm}`);
			for (const signature of document.signatures) lines.push(`T${seconds(signature.frame)} V- -timesig_numr:${signature.numerator} -timesig_denr:${signature.denominator}`);
		}
		const events: { frame: number; fields: string }[] = [];
		if (track.program !== undefined && !track.events?.some(event => (event.status & 240) === 192)) events.push({ frame: 0, fields: `V0 -programi:${track.program}` });
		for (const event of track.events ?? []) events.push({ frame: event.frame, fields: allegroEventFields(event) });
		for (const note of track.notes) events.push({ frame: note.startFrame, fields: `V${note.channel} K${note.pitch} P${note.pitch} U${seconds(note.durationFrames)} L${note.velocity}` });
		for (const event of events.sort((a, b) => a.frame - b.frame)) lines.push(`T${seconds(event.frame)} ${event.fields}`);
	}
	const text = `${lines.join('\n')}\n`;
	if (new TextEncoder().encode(text).length > MIDI_FILE_MAX_BYTES) throw new RangeError('Allegro export exceeds the 16 MiB limit.');
	return text;
}
