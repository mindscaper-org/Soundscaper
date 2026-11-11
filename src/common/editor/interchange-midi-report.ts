/* SPDX-License-Identifier: AGPL-3.0-only */
import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { createInterchangeVisibility } from './interchange-track-visibility.ts';

type DataRecord = Readonly<Record<string, unknown>>;

/** Audio edit-list profiles deliver the MIDI source's PCM rather than editable note authority. */
export function reportInterchangeMidiConversion(report: DeliveryReport, project: DataRecord): DeliveryReport {
	if (!['edl', 'otio', 'fcpxml', 'omf'].includes(report.subject.format)) return report;
	const tracks = records(project.tracks), clips = new Map(records(project.clips).map(clip => [String(clip.id), clip]));
	const visibility = createInterchangeVisibility(tracks, project);
	const owners = tracks.filter(track => visibility.contributes(track)).flatMap(track => {
		const metadata = readMidiTrack(track);
		const parts = (Array.isArray(track.clipIds) ? track.clipIds : []).map(id => readMidiClip(clips.get(String(id)))).filter(part => part !== null);
		return metadata || parts.length ? [{ track, metadata, parts }] : [];
	});
	if (!owners.length) return report;
	const draft = createDeliveryReport(report.subject);
	for (const item of report.items) addDeliveryReportItem(draft, item);
	for (const { track, metadata, parts } of owners) {
		const omitted = report.subject.format === 'edl' && report.items.some(item =>
			item.code === 'edl.audio-track-omitted' && item.scope?.id === String(track.id));
		addDeliveryReportItem(draft, {
		code: `${report.subject.format}.midi-authoring-converted`, disposition: omitted ? 'omitted' : 'converted',
		severity: 'warning', scope: { kind: 'track', id: String(track.id) },
		data: { clips: parts.length, notes: parts.reduce((count, part) => count + part.notes.length, 0),
			events: parts.reduce((count, part) => count + (part.interchange?.events.length ?? 0), 0),
			...(metadata ? { instrument: typeof metadata.instrument === 'string' ? metadata.instrument : metadata.instrument.name, ...(metadata.program === undefined ? {} : { program: metadata.program }) } : {}) },
		message: omitted
			? 'The selected EDL track excludes this MIDI track and its audio fallback. Use DAWproject or MIDI export to retain editable notes.'
			: 'The profile references the synthesized audio fallback; editable MIDI notes, messages and instrument authoring require DAWproject or MIDI export.',
		});
	}
	return sealDeliveryReport(draft);
}

function records(value: unknown): readonly DataRecord[] {
	return Array.isArray(value) ? value.filter((item): item is DataRecord => item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}
