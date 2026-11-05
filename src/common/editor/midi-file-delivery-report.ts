/* SPDX-License-Identifier: AGPL-3.0-only */
import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import type { MidiFileDocument } from './midi-file-types.ts';

/** The serialized note/update stream has no Allegro counterpart to an SMF end marker. */
export function midiFileDeliveryReport(document: MidiFileDocument, format: 'midi' | 'allegro'): DeliveryReport {
	const report = createDeliveryReport({ format, sampleRate: document.sampleRate });
	if (format === 'allegro') {
		const conductorEnd = [...document.tempos, ...document.signatures].reduce((end, event) => Math.max(end, event.frame), 0);
		const tracks = document.tracks.flatMap(track => {
			const noteEnd = track.notes.reduce((end, note) => Math.max(end, note.startFrame + note.durationFrames), conductorEnd);
			const contentEndFrame = (track.events ?? []).reduce((end, event) => Math.max(end, event.frame), noteEnd);
			return track.durationFrames !== undefined && track.durationFrames > contentEndFrame
				? [{ name: track.name, durationFrames: track.durationFrames, contentEndFrame }] : [];
		});
		if (tracks.length) addDeliveryReportItem(report, { code: 'ALLEGRO_TRACK_EXTENT_CONVERTED', disposition: 'converted',
			severity: 'warning', scope: { kind: 'tracks' }, data: { tracks } });
	}
	return sealDeliveryReport(report);
}
