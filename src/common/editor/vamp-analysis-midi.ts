/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVampAnalysisResult, vampFeatureFrameRange,
	type VampAnalysisResult, type VampOutputDescriptor } from './vamp-analysis.ts';
import type { MidiFileDocument } from './midi-file-types.ts';

/** Interpret only explicit note outputs; a pitch contour or chromagram is not a note sequence. */
export function vampMidiOutputKind(output: Readonly<VampOutputDescriptor>): 'frequency' | 'midi' | null {
	if (!output.hasDuration || output.sampleType !== 'variable-sample-rate') return null;
	if (output.id === 'notes' && output.unit === 'Hz') return 'frequency';
	if (['notes', 'chordnotes'].includes(output.id) && ['MIDI units', 'MIDI note'].includes(output.unit)) return 'midi';
	return null;
}

/** Note positions remain relative to the analyzed selection; the importer owns timeline placement. */
export function midiDocumentFromVampNotes(
	value: Readonly<VampAnalysisResult>, output: Readonly<VampOutputDescriptor>, name: string,
): MidiFileDocument {
	const result = normalizeVampAnalysisResult(value);
	const kind = vampMidiOutputKind(output);
	if (kind === null || output.id !== result.request.outputId) throw new TypeError('Select a supported note output for MIDI conversion.');
	if (typeof name !== 'string' || !name.trim() || name.length > 4_096) throw new TypeError('A MIDI track name is required.');
	if (!result.features.length) throw new RangeError('This result contains no notes.');
	const notes = result.features.map((feature, index) => {
		if (feature.values.length !== 1 || feature.duration === null) throw new TypeError('Each Vamp note requires one pitch and a duration.');
		const value = feature.values[0]!;
		const pitch = kind === 'frequency' ? Math.round(69 + 12 * Math.log2(value / 440)) : value;
		if (!Number.isSafeInteger(pitch) || pitch < 0 || pitch > 127) throw new RangeError('A Vamp note pitch is outside the MIDI range.');
		const range = vampFeatureFrameRange(result.request, feature);
		if (range.endFrame <= range.startFrame) throw new RangeError('A Vamp note duration must be positive.');
		return { id: `vamp-note-${String(index)}`, pitch,
			startFrame: range.startFrame - result.request.startFrame,
			durationFrames: range.endFrame - range.startFrame, velocity: 100, channel: 0 };
	});
	const document: MidiFileDocument = { sampleRate: result.request.sampleRate, tempos: [], signatures: [],
		tracks: [{ name: name.trim(), notes, durationFrames: result.request.endFrame - result.request.startFrame }] };
	return document;
}
