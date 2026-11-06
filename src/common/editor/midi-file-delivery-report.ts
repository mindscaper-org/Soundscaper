/* SPDX-License-Identifier: AGPL-3.0-only */
import { addDeliveryReportItem, createDeliveryReport, sealDeliveryReport, type DeliveryReport } from './delivery-report.ts';
import type { MidiFileDocument } from './midi-file-types.ts';
import { readMidiClip, readMidiTrack } from './midi-model.ts';
import { readClipLoop } from './audio-clip-loop.ts';
import { resolveRuntimeClipProjection, type RuntimeClipProject, type RuntimePersistedClip } from './runtime-clip-projection.ts';

interface MidiDeliveryProject extends RuntimeClipProject {
	readonly sampleRate: number;
	readonly clips: readonly RuntimePersistedClip[];
	readonly tracks: readonly Readonly<Record<string, unknown>>[];
	readonly sources?: readonly Readonly<Record<string, unknown>>[];
}

/** Inventory the note format's losses from its delivered stream and admitted project. */
export function midiFileDeliveryReport(document: MidiFileDocument, format: 'midi' | 'allegro', project?: MidiDeliveryProject): DeliveryReport {
	const report = createDeliveryReport({ format, sampleRate: document.sampleRate });
	if (project) addClipPitchOmissions(report, project);
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

/** The note stream retains source pitches; the PCM carrier's clip pitch is not serialized. */
function addClipPitchOmissions(report: ReturnType<typeof createDeliveryReport>, project: MidiDeliveryProject): void {
	const clips = new Map(project.clips.map(clip => [clip.id, clip]));
	const sources = new Map(project.sources?.map(source => [source.id, source]));
	for (const track of project.tracks) {
		if (!readMidiTrack(track) || !Array.isArray(track.clipIds)) continue;
		for (const id of track.clipIds) {
			const persisted = clips.get(id);
			if (!persisted || !readMidiClip(persisted)) continue;
			const clip = resolveRuntimeClipProjection(project, persisted);
			const sourceRate = Number(sources.get(clip.sourceId)?.sampleRate ?? project.sampleRate);
			const pitchCents = clip.linkPitchAndTempo === true
				? 1200 * Math.log2(clip.sourceDurationFrames * project.sampleRate
					/ ((readClipLoop(clip)?.periodFrames ?? clip.durationFrames) * sourceRate))
				: Number(clip.pitchCents ?? 0);
			if (pitchCents === 0) continue;
			addDeliveryReportItem(report, { code: 'MIDI_CLIP_PITCH_OMITTED', disposition: 'omitted', severity: 'warning',
				scope: { kind: 'clip', trackId: track.id, clipId: clip.id },
				data: { title: clip.title, pitchCents } });
		}
	}
}
