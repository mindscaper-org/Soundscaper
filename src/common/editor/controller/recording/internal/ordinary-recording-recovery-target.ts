/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAddSourceCommand, createAddTrackCommand } from '../../../commands/factories.ts';
import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import { preparePunchCommand } from '../../../commands/range-runtime.js';
import { projectForCommandConsumers } from '../../../project-current-runtime.ts';
import type { RecordingRecoveryJournal } from '../../../storage/recording-recovery-journal-repository.ts';
import type { RecordingProject } from '../recording-transaction-types.ts';
import { ordinaryRecordingRecoveryPunches } from './ordinary-recording-recovery-project.ts';

/** Build one exact publication with the owning product runtime, including repaired destinations. */
export function prepareOrdinaryRecordingRecoveryTarget<Project extends RecordingProject & Readonly<Record<string, unknown>>>(
	base: Project,
	journal: RecordingRecoveryJournal,
	apply: (project: Project, command: AudioEditorCommand, options: Readonly<{ now: string }>) => Project,
	now: string,
	recoveredTrackName: string,
): Project {
	let draft = base;
	const commands: AudioEditorCommand[] = [];
	const lanes = journal.lanes.map((lane) => {
		if (!lane.segments.length) return lane;
		const track = draft.tracks.find(({ id }) => id === lane.destination.trackId);
		if (track && track.locked !== true && track.type === 'audio') return lane;
		const trackId = `${journal.id}-${lane.id}-recovered-track`;
		if (!draft.tracks.some((candidate) => candidate.id === trackId && candidate.type === 'audio' && candidate.locked !== true)) {
			const add = createAddTrackCommand({ id: trackId, name: recoveredTrackName, armed: false });
			commands.push(add);
			draft = apply(draft, add, { now });
		}
		return { ...lane, destination: { ...lane.destination, trackId } };
	});
	const punches = ordinaryRecordingRecoveryPunches(draft, { ...journal, lanes });
	for (const { source, punch } of punches) {
		const consumer = projectForCommandConsumers(draft);
		const clips = consumer.clips as readonly Readonly<Record<string, unknown>>[];
		const track = draft.tracks.find(({ id }) => id === punch.trackId);
		if (clips.some((clip) => clip.sourceId === source.id && Array.isArray(track?.clipIds) && track.clipIds.includes(clip.id)
			&& clip.timelineStartFrame === punch.startFrame && clip.durationFrames === punch.endFrame - punch.startFrame
			&& clip.sourceStartFrame === punch.sourceStartFrame && clip.sourceDurationFrames === punch.sourceDurationFrames)) continue;
		const sources = draft.sources as readonly Readonly<Record<string, unknown>>[];
		const existing = sources.find(({ id }) => id === source.id);
		if (existing && (existing.frameCount !== source.frameCount || existing.sampleRate !== source.sampleRate || existing.storageKey !== source.storageKey)) throw new Error('A published recording checkpoint has different source metadata.');
		let clipId = punch.clipId;
		while (clips.some((clip) => clip.id === clipId)) clipId += '-recovered';
		const replace = preparePunchCommand(consumer, { ...punch, clipId }) as AudioEditorCommand;
		const next: AudioEditorCommand[] = [...(existing ? [] : [createAddSourceCommand(source)]), replace];
		commands.push(...next);
		draft = apply(draft, { type: 'batch', commands: next }, { now });
	}
	return commands.length ? apply(base, { type: 'batch', commands }, { now }) : base;
}
