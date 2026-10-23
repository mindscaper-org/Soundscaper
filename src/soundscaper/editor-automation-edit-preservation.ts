/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	replaceAutomationLaneTimelineIntervalV21,
	type AutomationLaneTimelineReplacementV21,
} from '../common/editor/automation-lane-interval-edit-v21.ts';
import type { AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { clipboardContainsVideo, pasteSpanForTrack } from '../common/editor/commands/clipboard-time-runtime.js';
import type { AudioEditorCommand } from '../common/editor/commands/protocol.ts';
import { mergeEditingRanges } from '../common/editor/commands/editing-selection-authority.ts';
import {
	resolveRangeSequenceGeometry,
	type RangeSampleSpan,
} from '../common/editor/commands/range-sequence-geometry.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import { resolveRuntimeProjectProjection } from '../common/editor/runtime-clip-projection.ts';

interface PlannedAutomationEditsV21 {
	readonly byTrackId: ReadonlyMap<string, readonly AutomationLaneTimelineReplacementV21[]>;
	/** Null means an all-track command exposed incompatible sequence maps. */
	readonly global: readonly AutomationLaneTimelineReplacementV21[] | null;
}

type DataRecord = Record<string, unknown>;

/** Multi-track processing emits one replacement per track, with one common programme edit. */
export function preserveGlobalAutomationAfterReplacementBatch(
	previous: SoundscaperProject,
	commanded: SoundscaperProject,
	command: Extract<AudioEditorCommand, { type: 'batch' }>,
): Readonly<Record<string, unknown>> {
	if (command.commands.some(child => child.type !== 'range/replace' && child.type !== 'range/ripple-delete' && child.type !== 'selection/set'
			&& !(child.type === 'clipboard/paste' && child.mode === 'insert-track'))) return commanded;
	const replacement = command.commands.find(child => child.type === 'range/replace');
	const replacementEdit = replacement ? [...planAutomationEdits(previous, commanded, replacement).byTrackId.values()][0]?.[0] : undefined;
	const byTrackId = new Map<string, readonly AutomationLaneTimelineReplacementV21[]>();
	for (const child of command.commands) {
		if (child.type === 'selection/set') continue;
		const plan = planAutomationEdits(previous, commanded, child);
		// A child that already edited the complete programme must not move it twice.
		if (plan.global === null || plan.global.length) return commanded;
		for (const [trackId, edits] of plan.byTrackId) {
			if (byTrackId.has(trackId)) return commanded;
			// A silent target expresses the same suffix move as an insertion or deletion
			// at the selection end. The processed material owns the programme interval.
			byTrackId.set(trackId, replacementEdit && child.type !== 'range/replace' && edits.length === 1
				&& isSilentReplacementSuffix(edits[0]!, replacementEdit) ? [replacementEdit] : edits);
		}
	}
	if (!coversEveryMediaTrack(previous, [...byTrackId.keys()])) return commanded;
	const edgeTracks = new Map(previous.mixer.edges.flatMap(edge => edge.source.kind === 'track'
		? [[edge.id, edge.source.id] as const] : []));
	if (!commanded.automationLanes.some(lane => addressedTrackId(lane, edgeTracks) === null)) return commanded;
	const edits = commonEditSeries(byTrackId);
	if (edits === null) throw new RangeError('All-track automation cannot reconcile distinct sequence interval maps.');
	const options = { sampleRate: previous.sampleRate, tempoMap: previous.tempoMap };
	return { ...commanded, automationLanes: commanded.automationLanes.map(lane => (
		addressedTrackId(lane, edgeTracks) !== null ? lane : edits.reduce((current, edit) => (
			edit.endFrame - edit.startFrame === edit.insertedDurationFrames ? current
				: replaceAutomationLaneTimelineIntervalV21(current, edit, options)
		), lane)
	)) };
}

function isSilentReplacementSuffix(edit: AutomationLaneTimelineReplacementV21, replacement: AutomationLaneTimelineReplacementV21): boolean {
	const delta = replacement.insertedDurationFrames - (replacement.endFrame - replacement.startFrame);
	return edit.endFrame === replacement.endFrame && (delta >= 0
		? edit.startFrame === edit.endFrame && edit.insertedDurationFrames === delta
		: edit.startFrame === replacement.endFrame + delta && edit.insertedDurationFrames === 0);
}

/** Apply only command-declared timeline geometry to surviving baseline lanes. */
export function preserveAutomationLanesAfterInheritedCommand(
	previous: SoundscaperProject,
	commanded: Readonly<Record<string, unknown>>,
	command: AudioEditorCommand,
	lanes: readonly AutomationLaneV21[],
): readonly AutomationLaneV21[] {
	const plan = planAutomationEdits(previous, commanded, command);
	if (plan.byTrackId.size === 0 && plan.global?.length === 0) return lanes;
	const edgeTracks = new Map(previous.mixer.edges.flatMap(edge => edge.source.kind === 'track'
		? [[edge.id, edge.source.id] as const] : []));
	if (plan.global === null && lanes.some((lane) => addressedTrackId(lane, edgeTracks) === null)) {
		throw new RangeError('All-track automation cannot reconcile distinct sequence interval maps.');
	}
	const options = { sampleRate: previous.sampleRate, tempoMap: previous.tempoMap };
	return lanes.map((lane) => {
		const trackId = addressedTrackId(lane, edgeTracks);
		const edits = trackId === null ? plan.global ?? [] : plan.byTrackId.get(trackId) ?? [];
		return edits.reduce((current, edit) => (
			edit.endFrame - edit.startFrame === edit.insertedDurationFrames ? current
				: replaceAutomationLaneTimelineIntervalV21(current, edit, options)
		), lane);
	});
}

function planAutomationEdits(
	previous: SoundscaperProject,
	commanded: Readonly<Record<string, unknown>>,
	command: AudioEditorCommand,
): PlannedAutomationEditsV21 {
	if (command.type === 'range/ripple-delete') {
		return rangePlan(previous, command.trackIds ?? mediaTrackIds(previous), {
			startFrame: command.startFrame,
			endFrame: command.endFrame,
			insertedDurationFrames: 0,
		}, true);
	}
	if (command.type === 'range/replace') {
		const replacement = resolvedClipRecords(commanded)
			.find((clip) => clip.id === command.clipId);
		if (!replacement) throw new RangeError('A range replacement did not publish its replacement clip.');
		return trackPlan(command.trackId, {
			startFrame: command.startFrame,
			endFrame: command.endFrame,
			insertedDurationFrames: positiveSafeInteger(
				replacement.durationFrames, 'replacement clip.durationFrames',
			),
		});
	}
	if (command.type === 'clipboard/paste'
		&& (command.mode === 'insert-track' || command.mode === 'insert-all')) {
		return clipboardInsertPlan(previous, command);
	}
	if (command.type === 'edit/insert') {
		return rangePlan(previous, command.trackIds, {
			startFrame: command.startFrame,
			endFrame: command.endFrame,
			insertedDurationFrames: command.endFrame - command.startFrame,
		}, true, true);
	}
	if (command.type === 'clip/remove-many' && command.rippleMode === 'track') {
		return removedClipPlan(previous, commanded);
	}
	if (command.type === 'clip/render-replace-many') {
		if (command.rippleMode !== 'track') return emptyPlan();
		return renderedClipReplacementPlan(previous, commanded, command);
	}
	if (command.type === 'project-bin/replace-media' && command.shortfallMode === 'contract-gaps') {
		return binReplacementPlan(previous, commanded, command);
	}
	return emptyPlan();
}

/** Replacement closes only the removed source tails, independently on each track. */
function binReplacementPlan(
	previous: SoundscaperProject,
	commanded: Readonly<Record<string, unknown>>,
	command: Extract<AudioEditorCommand, { type: 'project-bin/replace-media' }>,
): PlannedAutomationEditsV21 {
	const affectedSources = new Set(command.replacements.map(({ oldSourceId }) => oldSourceId));
	const nextById = new Map(resolvedClipRecords(commanded).map(clip => [String(clip.id), clip]));
	const owners = trackOwnership(previous);
	const byTrackId = new Map<string, AutomationLaneTimelineReplacementV21[]>();
	for (const clip of resolvedClipRecords(previous)) {
		if (!affectedSources.has(String(clip.sourceId))) continue;
		const trackId = owners.get(String(clip.id));
		if (!trackId) continue;
		const next = nextById.get(String(clip.id));
		const endFrame = clipEnd(clip);
		const retained = next ? positiveSafeInteger(next.durationFrames, 'replacement clip.durationFrames') : 0;
		const startFrame = safeAdd(clipStart(clip), retained);
		if (startFrame >= endFrame) continue;
		const edits = byTrackId.get(trackId) ?? [];
		edits.push({ startFrame, endFrame, insertedDurationFrames: 0 });
		byTrackId.set(trackId, edits);
	}
	for (const [trackId, edits] of byTrackId) byTrackId.set(trackId, mergeEditingRanges(edits).reverse().map(range => ({
		startFrame: range.startFrame, endFrame: range.endFrame, insertedDurationFrames: 0,
	})));
	return { byTrackId, global: [] };
}

function rangePlan(
	project: SoundscaperProject,
	trackIds: readonly string[],
	base: AutomationLaneTimelineReplacementV21,
	allowGlobal: boolean,
	insertion = false,
): PlannedAutomationEditsV21 {
	const geometry = resolveRangeSequenceGeometry(project, trackIds, base);
	const byTrackId = new Map<string, readonly AutomationLaneTimelineReplacementV21[]>();
	for (const trackId of trackIds) {
		const span = geometry.trackRanges.get(trackId) ?? sampleSpan(base);
		if (span === null) continue;
		byTrackId.set(trackId, [insertion ? {
			startFrame: span.startFrame,
			endFrame: span.startFrame,
			insertedDurationFrames: span.durationFrames,
		} : {
			startFrame: span.startFrame,
			endFrame: span.endFrame,
			insertedDurationFrames: base.insertedDurationFrames,
		}]);
	}
	const global = allowGlobal && coversEveryMediaTrack(project, trackIds)
		? commonEditSeries(byTrackId)
		: [];
	return { byTrackId, global };
}

function clipboardInsertPlan(
	project: SoundscaperProject,
	command: Extract<AudioEditorCommand, { readonly type: 'clipboard/paste' }>,
): PlannedAutomationEditsV21 {
	const scale = project.sampleRate / command.clipboard.sampleRate;
	if (!Number.isFinite(scale) || scale <= 0) throw new RangeError('The clipboard sample rate is invalid.');
	const durationFrames = Math.max(1, Math.round(command.clipboard.durationFrames * scale));
	const targetIds = new Set(command.clipboard.tracks.map((track) => (
		command.trackMap?.[track.sourceTrackId] ?? track.sourceTrackId
	)));
	const trackIds = command.collisionTrackIds?.length
		? command.collisionTrackIds
		: command.mode === 'insert-all'
			? mediaTrackIds(project)
			: mediaTrackIds(project).filter((trackId) => targetIds.has(trackId));
	const conform = clipboardContainsVideo(command.clipboard) as boolean;
	const byTrackId = new Map<string, readonly AutomationLaneTimelineReplacementV21[]>();
	for (const trackId of trackIds) {
		const span = pasteSpanForTrack(
			project, trackId, command.atFrame, durationFrames, conform,
		) as RangeSampleSpan;
		byTrackId.set(trackId, [{
			startFrame: span.startFrame,
			endFrame: span.startFrame,
			insertedDurationFrames: span.durationFrames,
		}]);
	}
	const global = command.mode === 'insert-all' && coversEveryMediaTrack(project, trackIds)
		? commonEditSeries(byTrackId)
		: [];
	return { byTrackId, global };
}

function removedClipPlan(
	previous: SoundscaperProject,
	commanded: Readonly<Record<string, unknown>>,
): PlannedAutomationEditsV21 {
	const surviving = new Set(recordArray(commanded.clips, 'commanded.clips').map(({ id }) => String(id)));
	const trackByClipId = new Map<string, string>();
	for (const track of recordArray(previous.tracks, 'previous.tracks')) {
		if (!Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) trackByClipId.set(String(clipId), String(track.id));
	}
	const byTrackId = new Map<string, AutomationLaneTimelineReplacementV21[]>();
	for (const clip of resolvedClipRecords(previous)) {
		const id = String(clip.id);
		if (surviving.has(id)) continue;
		const trackId = trackByClipId.get(id);
		if (!trackId) continue;
		const startFrame = nonNegativeSafeInteger(clip.timelineStartFrame, `clip ${id}.timelineStartFrame`);
		const durationFrames = positiveSafeInteger(clip.durationFrames, `clip ${id}.durationFrames`);
		const edits = byTrackId.get(trackId) ?? [];
		edits.push({ startFrame, endFrame: safeAdd(startFrame, durationFrames), insertedDurationFrames: 0 });
		byTrackId.set(trackId, edits);
	}
	for (const [trackId, edits] of byTrackId) byTrackId.set(trackId, mergeEditingRanges(edits).reverse().map(range => ({
		startFrame: range.startFrame, endFrame: range.endFrame, insertedDurationFrames: 0,
	})));
	return { byTrackId, global: [] };
}

function renderedClipReplacementPlan(
	previous: SoundscaperProject,
	commanded: Readonly<Record<string, unknown>>,
	command: Extract<AudioEditorCommand, { readonly type: 'clip/render-replace-many' }>,
): PlannedAutomationEditsV21 {
	const previousClips = resolvedClipRecords(previous);
	const nextById = new Map(resolvedClipRecords(commanded)
		.map((clip) => [String(clip.id), clip]));
	const trackByClipId = trackOwnership(previous);
	const pending = new Set(command.entries.map(({ clipId }) => clipId));
	const byTrackId = new Map<string, AutomationLaneTimelineReplacementV21[]>();
	while (pending.size > 0) {
		const seed = pending.values().next().value;
		if (seed === undefined) break;
		const related = relatedClipIds(previousClips, seed);
		for (const clipId of related) pending.delete(clipId);
		const originals = previousClips.filter((clip) => related.has(String(clip.id)));
		const replacements = originals.map((clip) => nextById.get(String(clip.id)))
			.filter((clip): clip is DataRecord => clip !== undefined);
		if (originals.length === 0 || replacements.length !== originals.length) {
			throw new RangeError('Rendered replacement did not retain complete related clip authority.');
		}
		const startFrame = Math.min(...originals.map(clipStart));
		const endFrame = Math.max(...originals.map(clipEnd));
		const nextEndFrame = Math.max(...replacements.map(clipEnd));
		const insertionFrames = command.entries.filter(({ clipId }) => related.has(clipId))
			.map(({ insertionFrame }) => insertionFrame);
		const insertionFrame = insertionFrames.find(frame => frame !== undefined);
		if (insertionFrame !== undefined && (!Number.isSafeInteger(insertionFrame)
			|| insertionFrame < startFrame || insertionFrame > endFrame || nextEndFrame <= endFrame
			|| insertionFrames.some(frame => frame !== insertionFrame))) {
			throw new RangeError('Joined insertion must retain one valid insertion point and extend its clip.');
		}
		const edit = insertionFrame === undefined ? {
			startFrame, endFrame,
			insertedDurationFrames: nextEndFrame - startFrame,
		} : { startFrame: insertionFrame, endFrame: insertionFrame, insertedDurationFrames: nextEndFrame - endFrame };
		for (const trackId of new Set(originals.map((clip) => trackByClipId.get(String(clip.id))))) {
			if (trackId === undefined) continue;
			const edits = byTrackId.get(trackId) ?? [];
			edits.push(edit);
			byTrackId.set(trackId, edits);
		}
	}
	for (const edits of byTrackId.values()) edits.sort((left, right) => right.startFrame - left.startFrame);
	return { byTrackId, global: [] };
}

function relatedClipIds(clips: readonly DataRecord[], seed: string): ReadonlySet<string> {
	const result = new Set([seed]);
	let changed = true;
	while (changed) {
		changed = false;
		const groups = new Set(clips.filter((clip) => result.has(String(clip.id)))
			.map(({ groupId }) => groupId).filter(Boolean).map(String));
		const links = new Set(clips.filter((clip) => result.has(String(clip.id)))
			.map(({ avLinkId }) => avLinkId).filter(Boolean).map(String));
		for (const clip of clips) {
			if ((clip.groupId && groups.has(String(clip.groupId)))
				|| (clip.avLinkId && links.has(String(clip.avLinkId)))) {
				const size = result.size;
				result.add(String(clip.id));
				if (result.size !== size) changed = true;
			}
		}
	}
	return result;
}

function commonEditSeries(
	byTrackId: ReadonlyMap<string, readonly AutomationLaneTimelineReplacementV21[]>,
): readonly AutomationLaneTimelineReplacementV21[] | null {
	const series = [...byTrackId.values()];
	const first = series[0] ?? [];
	if (series.some((candidate) => JSON.stringify(candidate) !== JSON.stringify(first))) {
		return null;
	}
	return first;
}

function addressedTrackId(lane: AutomationLaneV21, edgeTracks: ReadonlyMap<string, string>): string | null {
	if (lane.address.kind === 'edge') return edgeTracks.get(lane.address.edgeId) ?? null;
	return lane.address.strip.kind === 'track' ? lane.address.strip.id : null;
}

function trackPlan(
	trackId: string,
	edit: AutomationLaneTimelineReplacementV21,
): PlannedAutomationEditsV21 {
	return { byTrackId: new Map([[trackId, [edit]]]), global: [] };
}

function emptyPlan(): PlannedAutomationEditsV21 {
	return { byTrackId: new Map(), global: [] };
}

function coversEveryMediaTrack(project: SoundscaperProject, values: readonly string[]): boolean {
	const requested = new Set(values);
	const all = mediaTrackIds(project);
	return all.length > 0 && all.every((trackId) => requested.has(trackId));
}

function mediaTrackIds(project: SoundscaperProject): string[] {
	return project.tracks.filter((track) => Array.isArray(track.clipIds)).map(({ id }) => String(id));
}

function trackOwnership(project: SoundscaperProject): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const track of project.tracks) {
		if (!Array.isArray(track.clipIds)) continue;
		for (const clipId of track.clipIds) result.set(String(clipId), String(track.id));
	}
	return result;
}

function sampleSpan(value: AutomationLaneTimelineReplacementV21): RangeSampleSpan {
	return {
		startFrame: value.startFrame,
		endFrame: value.endFrame,
		durationFrames: value.endFrame - value.startFrame,
	};
}

function clipStart(clip: DataRecord): number {
	return nonNegativeSafeInteger(clip.timelineStartFrame, `clip ${String(clip.id)}.timelineStartFrame`);
}

/** Persisted musical clips carry beats; interval planning always reads resolved samples. */
function resolvedClipRecords(project: Readonly<Record<string, unknown>>): DataRecord[] {
	return recordArray(resolveRuntimeProjectProjection(project).clips, 'resolved project.clips');
}

function clipEnd(clip: DataRecord): number {
	return safeAdd(clipStart(clip), positiveSafeInteger(
		clip.durationFrames, `clip ${String(clip.id)}.durationFrames`,
	));
}

function recordArray(value: unknown, name: string): DataRecord[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((candidate, index) => dataRecord(candidate, `${name}[${String(index)}]`));
}

function dataRecord(value: unknown, name: string): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as DataRecord;
}

function nonNegativeSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Object.is(value, -0)) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return Number(value);
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number): number {
	const result = left + right;
	if (!Number.isSafeInteger(result) || result < 0) throw new RangeError('Timeline geometry exceeds the safe integer domain.');
	return result;
}
