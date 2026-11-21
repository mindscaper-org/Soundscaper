/* SPDX-License-Identifier: AGPL-3.0-only */

import { resolveEmbeddedExportChapters, supportsEmbeddedExportChapters } from '../export-embedded-chapters.ts';
import { exportChapterLabelTracks, readEmbedChapters, readEmbeddedChapterTrack, type EmbeddedChapterTrack } from '../export-chapter-track.ts';
import { exportChapterCueOptions } from '../export-chapter-cue-options.ts';
import { createRiffAnnotationExport } from '../timeline-annotation-riff-interchange.ts';
import { MEDIA_EXPORT_FORMATS, mediaExportFormatCarriesCues } from '../media-export.js';
import { projectDurationFrames } from '../project.js';
import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import { isTimelineAnnotationProjectSchema } from '../project-schema-version.ts';
import type { RuntimeClipProject } from '../runtime-clip-projection.ts';
import { scaleSampleFrame } from '../timeline-time.ts';
import { exportSequenceProject } from '../export-sequence-project.ts';
import { resolveSelectionRange } from '../selection-range.ts';

type Data = Readonly<Record<string, unknown>>;

interface ChapterTrackOption {
	readonly value: EmbeddedChapterTrack;
	readonly name?: string;
}

function cueFormat(format: unknown): format is string {
	return typeof format === 'string' && Object.hasOwn(MEDIA_EXPORT_FORMATS, format) && mediaExportFormatCarriesCues(format);
}

/** Embedded chapters follow the mixed delivery timeline. Pristine BW64 owns its original chunks. */
export function exportDialogSupportsEmbeddedChapters(settings: Data): boolean {
	return (supportsEmbeddedExportChapters(settings.format) || cueFormat(settings.format))
		&& settings.mode === 'mix' && !settings.masteringSequenceId
		&& !(settings.format === 'bw64' && record(settings.adm).mode === 'passthrough');
}

export function exportDialogHasChapterLabels(projectValue: unknown): boolean {
	const project = exportSequenceProject(record(projectValue));
	return exportChapterLabelTracks(project).some(track => Array.isArray(track.labels) && track.labels.length > 0);
}

/** Availability follows the encoder's half-open range and frame rounding. */
export function exportDialogHasDeliveredChapterLabels(projectValue: unknown, settings: Data): boolean {
	try {
		const selectedProject = exportSequenceProject(projectValue as RuntimeClipProject);
		return chapterTrackAvailable(resolveDialogChapterDelivery(selectedProject, settings), settings.format, 'all-label-tracks', false);
	} catch { return false; }
}

export function exportDialogEmbeddedChapterModel(projectValue: unknown, settings: Data) {
	const selectedProject = exportSequenceProject(record(projectValue));
	const labelTracks = exportChapterLabelTracks(selectedProject);
	const labels = labelTracks.filter(track => Array.isArray(track.labels) && track.labels.length > 0);
	const tracks: ChapterTrackOption[] = labels.flatMap(track => typeof track.id === 'string' && track.id
		? [{ value: `label:${track.id}` as const, name: typeof track.name === 'string' ? track.name : '' }]
		: []);
	if (labels.length > 1 || (labels.length === 1 && !tracks.length)) tracks.unshift({ value: 'all-label-tracks' });
	if (isTimelineAnnotationProjectSchema(selectedProject) && Array.isArray(selectedProject.timelineAnnotations)
		&& selectedProject.timelineAnnotations.some(marker => record(marker).sequenceId === selectedProject.primarySequenceId)) {
		tracks.unshift({ value: 'markers' });
	}
	const carriesCues = cueFormat(settings.format);
	const automatic = automaticCueTrack(selectedProject, labelTracks[0]);
	const explicit = readEmbeddedChapterTrack(settings.embeddedChapterTrack);
	const defaultTrack = carriesCues ? automatic : tracks.find(track => track.value === 'all-label-tracks')?.value
		?? tracks.find(track => track.value !== 'markers')?.value;
	const track = tracks.find(option => option.value === explicit)?.value
		?? tracks.find(option => option.value === defaultTrack)?.value ?? tracks[0]?.value;
	if (track === undefined) return { tracks, track, available: false, checked: false };
	try {
		const delivery = resolveDialogChapterDelivery(selectedProject as RuntimeClipProject, settings);
		const available = chapterTrackAvailable(delivery, settings.format, track, carriesCues);
		const defaultEnabled = carriesCues
			? automatic === track ? available : automatic !== undefined && chapterTrackAvailable(delivery, settings.format, automatic, true)
			: settings.embedLabelChapters === true && chapterTrackAvailable(delivery, settings.format, 'all-label-tracks', false);
		return { tracks, track, available, checked: (readEmbedChapters(settings.embedChapters) ?? defaultEnabled) && available };
	} catch { return { tracks, track, available: false, checked: false }; }
}

/** An unstated PCM setting keeps the cue writer's automatic policy. */
export function exportDialogEmbeddedChapterRequest(settings: Data, project: unknown) {
	if (!exportDialogSupportsEmbeddedChapters(settings)) return {};
	const enabled = readEmbedChapters(settings.embedChapters);
	const track = readEmbeddedChapterTrack(settings.embeddedChapterTrack);
	if (enabled === undefined && track === undefined) {
		return settings.embedLabelChapters === true && supportsEmbeddedExportChapters(settings.format)
			&& (project === undefined || exportDialogHasDeliveredChapterLabels(project, settings)) ? { embedLabelChapters: true } : {};
	}
	if (project === undefined) return {
		...(enabled === undefined ? {} : { embedChapters: enabled }),
		...(enabled === true && track !== undefined ? { embeddedChapterTrack: track } : {}),
	};
	const model = exportDialogEmbeddedChapterModel(project, settings);
	return model.checked ? { embedChapters: true, embeddedChapterTrack: model.track } : { embedChapters: false };
}

function automaticCueTrack(project: Data, firstLabelTrack: Data | undefined): EmbeddedChapterTrack | undefined {
	if (isTimelineAnnotationProjectSchema(project)) return 'markers';
	return typeof firstLabelTrack?.id === 'string' && firstLabelTrack.id ? `label:${firstLabelTrack.id}` : undefined;
}

function chapterTrackAvailable(delivery: ReturnType<typeof resolveDialogChapterDelivery>, format: unknown, track: EmbeddedChapterTrack, carriesCues: boolean): boolean {
	const { project, sampleRate, range } = delivery;
	if (!range || range.endFrame <= range.startFrame) return false;
	if (carriesCues) {
		const source = exportChapterCueOptions(format, true, { embedChapters: true, embeddedChapterTrack: track }, false);
		return createRiffAnnotationExport(project, { ...source, range, outputSampleRate: sampleRate }).markers.length > 0;
	}
	const rangeOutputFrames = Math.max(1, scaleSampleFrame(range.endFrame - range.startFrame, Number(project.sampleRate), sampleRate, 'enclosingEnd'));
	return resolveEmbeddedExportChapters(project, range, sampleRate, { rangeOutputFrames, track }).length > 0;
}

function resolveDialogChapterDelivery(selectedProject: RuntimeClipProject, settings: Data) {
	const project = projectForRuntimeConsumers(selectedProject);
	const sampleRate = Number(settings.sampleRate ?? project.sampleRate);
	const selected = settings.range === 'loop' ? project.loop : settings.range;
	const span = record(selected);
	const range = settings.range === 'selection' ? resolveSelectionRange(project)
		: settings.range === 'loop' && !span.enabled ? null
		: typeof selected === 'object' && selected !== null
			? { startFrame: Number(span.startFrame), endFrame: Number(span.endFrame) }
			: { startFrame: 0, endFrame: projectDurationFrames(project) };
	return { project, sampleRate, range };
}

function record(value: unknown): Data {
	return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Data : {};
}
