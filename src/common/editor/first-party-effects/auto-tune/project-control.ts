/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMidiTrack, readMidiClip } from '../../midi-model.ts';
import { midiProjectTiming } from '../../midi-project-timing.ts';
import { midiClipOccurrences } from '../../midi-project-source-projection.ts';
import type { EngineProject, EngineGainOwner } from '../../engine/types.ts';
import { AUTO_TUNE_MAX_CONTROL_NOTES, type AutoTuneControlNote } from './control-notes.ts';

/** Resolve keyed MIDI notes through the same clip timing used by playback and
 * interchange. Mute/solo and instrument audio do not change control pitches. */
export function autoTuneControlNotes(project: EngineProject, trackId: string, fromFrame: number,
	frames: number, outputSampleRate: number): AutoTuneControlNote[] {
	if (!trackId) return [];
	const track = project.tracks?.find(track => track.id === trackId);
	if (!track || !isMidiTrack(track)) throw new RangeError('The Auto-Tune MIDI control track is no longer available.');
	const sampleRate = project.sampleRate ?? 48000;
	const timing = midiProjectTiming({ ...project, sampleRate });
	const projection = { sampleRate, tempoMap: timing.tempoMap };
	const clips = new Map(project.clips?.map(clip => [String(clip.id), clip]));
	const notes: AutoTuneControlNote[] = [];
	const ratio = outputSampleRate / sampleRate;
	const end = fromFrame + frames / ratio;
	for (const id of track.clipIds ?? []) {
		const clip = clips.get(String(id)), data = readMidiClip(clip);
		if (!clip || !data) continue;
		for (const occurrence of midiClipOccurrences(projection, clip)) {
			if (occurrence.timelineEnd <= fromFrame || occurrence.timelineStart >= end) continue;
			for (const note of data.notes) {
				if (note.onsetStop) continue;
				const start = Math.max(occurrence.start, note.startFrame);
				const stop = Math.min(occurrence.start + occurrence.sourceFrames, note.startFrame + note.durationFrames);
				if (stop <= start) continue;
				const a = occurrence.global(start), b = occurrence.global(stop);
				const startFrame = Math.max(0, Math.round((Math.min(a, b) - fromFrame) * ratio));
				const endFrame = Math.min(frames, Math.round((Math.max(a, b) - fromFrame) * ratio));
				if (endFrame <= startFrame) continue;
				if (notes.length === AUTO_TUNE_MAX_CONTROL_NOTES) throw new RangeError('Too many Auto-Tune MIDI control notes.');
				notes.push({ startFrame, endFrame, pitch: note.pitch });
			}
		}
	}
	return notes.sort((a, b) => a.startFrame - b.startFrame || a.pitch - b.pitch);
}

export function autoTuneSelectionContext(project: EngineProject, params: Readonly<Record<string, unknown>>,
	startFrame: number, frames: number, sampleRate: number): Readonly<{ controlNotes?: readonly AutoTuneControlNote[] }> {
	return params.controlTrackId ? { controlNotes: autoTuneControlNotes(project, String(params.controlTrackId), startFrame, frames, sampleRate) } : {};
}

/** Preserve MIDI dependencies when rendering a subset of programme strips. */
export function autoTuneControlTrackIds(owners: readonly EngineGainOwner[]): string[] {
	return owners.flatMap(owner => owner.effectsActive === false ? [] : (owner.effects ?? [])
		.filter(effect => effect.type === 'auto-tune' && effect.enabled !== false && effect.bypassed !== true && typeof effect.params?.controlTrackId === 'string' && effect.params.controlTrackId)
		.map(effect => String(effect.params!.controlTrackId)));
}
