/* SPDX-License-Identifier: AGPL-3.0-only */

import { barStartBeat } from './musical-grid.ts';
import { createIndexedBeatFrameProjector } from './indexed-tempo-projector.ts';
import { normalizeRational, type HoldTempoMap, type Rational, type SampleFrame } from './timeline-time.ts';
import type { MidiFileSignature, MidiFileTempo } from './midi-file-types.ts';

interface TimingProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly tempo?: Readonly<{ bpm?: number; timeSignature?: Readonly<{ numerator?: number; denominator?: number }> }>;
}

export function midiProjectTiming(project: TimingProject) {
	const rawMap = record(project.tempoMap);
	const rawEvents = Array.isArray(rawMap.events) ? rawMap.events.map(record) : [];
	const tempoMap: HoldTempoMap = {
		mode: rawMap.mode === 'sampleLocked' ? 'sampleLocked' : 'musical',
		events: rawEvents.length ? rawEvents.map(event => ({
			beat: rational(event.beat), bpm: rational(event.bpm),
			...(event.samplePosition === undefined ? {} : { samplePosition: integer(event.samplePosition) as SampleFrame }),
		})) : [{ beat: { num: 0, den: 1 }, bpm: rational(project.tempo?.bpm ?? 120) }],
	};
	const projectFrame = createIndexedBeatFrameProjector(tempoMap, project.sampleRate);
	const tempos: MidiFileTempo[] = tempoMap.events.map(event => ({ frame: projectFrame(event.beat), bpm: event.bpm.num / event.bpm.den }));
	const rawSignatures = record(project.signatureMap);
	const signatureEvents = Array.isArray(rawSignatures.events) ? rawSignatures.events.map(value => {
		const event = record(value);
		return { bar: integer(event.bar), numerator: integer(event.numerator), denominator: integer(event.denominator) };
	}) : [{ bar: 0, numerator: project.tempo?.timeSignature?.numerator ?? 4, denominator: project.tempo?.timeSignature?.denominator ?? 4 }];
	const signatureMap = { events: signatureEvents };
	const signatures: MidiFileSignature[] = signatureEvents.map(event => ({
		frame: projectFrame(barStartBeat(event.bar, signatureMap)), numerator: event.numerator, denominator: event.denominator,
	}));
	return { tempoMap, tempos, signatures, hasTempoChanges: tempos.length > 1, hasSignatureChanges: signatures.length > 1 };
}

function record(value: unknown): Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, unknown>> : {};
}

function rational(value: unknown): Rational {
	const options = { maximumDenominator: Number.MAX_SAFE_INTEGER };
	if (typeof value === 'number') return normalizeRational(value, options);
	const candidate = record(value);
	if (typeof candidate.num !== 'number' || typeof candidate.den !== 'number') throw new RangeError('Invalid MIDI project timing rational.');
	return normalizeRational({ num: candidate.num, den: candidate.den }, options);
}

function integer(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('Invalid MIDI project timing position or signature.');
	return Number(value);
}
