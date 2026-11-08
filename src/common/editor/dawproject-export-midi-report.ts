/* SPDX-License-Identifier: AGPL-3.0-only */

import { addDeliveryReportItem } from './delivery-report.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import type { DataRecord, DawprojectExportContext } from './dawproject-export-context.ts';

/** This audio-only profile delivers the PCM, but not its editable MIDI authority. */
export function reportDawprojectMidiConversion(track: DataRecord, clips: readonly DataRecord[], context: DawprojectExportContext): void {
	const owner = readMidiTrack(track);
	const parts = clips.map(readMidiClip).filter(part => part !== null);
	if (!owner && parts.length === 0) return;
	addDeliveryReportItem(context.draft, {
		code: 'dawproject.midi-authoring-converted', disposition: 'converted', severity: 'warning',
		scope: { kind: 'track', id: String(track.id) },
		data: { clips: parts.length, notes: parts.reduce((count, part) => count + part.notes.length, 0),
			events: parts.reduce((count, part) => count + (part.interchange?.events.length ?? 0), 0),
			...(owner ? { instrument: owner.instrument, ...(owner.program === undefined ? {} : { program: owner.program }) } : {}) },
		message: 'Editable MIDI notes, messages, and instrument settings are converted to fallback audio; save the native project to retain MIDI authoring.',
	});
}
