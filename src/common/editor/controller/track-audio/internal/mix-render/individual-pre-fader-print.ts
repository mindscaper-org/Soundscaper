/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21, type AutomationLaneV21 } from '../../../../automation-lane-v21.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21, type MixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import { mixerEdgeCarriesSignalV21 } from '../../../../mixer-signal-edge-v21.ts';
import { isSoundscaperProductionProject } from '../../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../../terminal-channel-widths.ts';
import { isControllerPcmSource, type ControllerProject, type ControllerTrack, type MutableControllerProject } from '../../track-domain-types.ts';

/** A retained pre-fader tap needs a print before the controls that distinguish both taps. */
export function individualPreFaderPrintWidth(project: ControllerProject, track: ControllerTrack, renderEffects = true): number | null {
	return prepareIndividualPreFaderPrint(project).width(track, renderEffects);
}

/** This detached routing/automation index belongs to one owned Mix and Render operation. */
export function prepareIndividualPreFaderPrint(project: ControllerProject, preparedGraph?: MixerGraphV21): Readonly<{
	width(track: ControllerTrack, renderEffects?: boolean): number | null;
	laneCommands(sourceId: string, targetId: string, createId: (prefix: string) => string): AudioEditorCommand[];
}> {
	if (!isSoundscaperProductionProject(project)) return { width: () => null,
		laneCommands: (sourceId, targetId, createId) => individualPrintLaneCommands(project, sourceId, targetId, createId) };
	const graph = preparedGraph ?? normalizeMixerGraphV21(project.mixer);
	const lanes = automationLanes(project);
	const trackLanes = new Map<string, AutomationLaneV21[]>();
	for (const lane of lanes) if ((lane.address.kind === 'strip' || lane.address.kind === 'effect') && lane.address.strip.kind === 'track') {
		const key = lane.address.strip.id, current = trackLanes.get(key);
		if (current) current.push(lane); else trackLanes.set(key, [lane]);
	}
	const positiveEdges = new Set(lanes.flatMap(lane => lane.address.kind === 'edge'
		&& lane.points.some(point => point.value > 0) ? [lane.address.edgeId] : []));
	const preTracks = new Set(graph.edges.flatMap(edge => edge.source.kind === 'track'
		&& edge.position === 'pre-fader' && mixerEdgeCarriesSignalV21(edge)
		&& (edge.level > 0 || positiveEdges.has(edge.id)) ? [edge.source.id] : []));
	const widths = preTracks.size ? resolveTerminalChannelWidths(project, Number(project.masterChannels)).tracks : new Map<string, number>();
	const clips = new Map(project.clips.map(clip => [clip.id, clip]));
	const sources = new Map(project.sources.map(source => [source.id, source]));
	const results = new Map<string, Map<boolean, number>>();
	return { width, laneCommands: (sourceId, targetId, createId) => printLaneCommands(trackLanes.get(sourceId) ?? [], sourceId, targetId, createId) };
	function width(track: ControllerTrack, renderEffects = true): number | null {
		if (!preTracks.has(track.id)) return null;
		const cached = results.get(track.id)?.get(renderEffects);
		if (cached !== undefined) return cached;
		const width = widths.get(track.id)!;
		const sourceWidths = new Set((track.clipIds ?? []).flatMap(id => {
			const clip = clips.get(id), source = clip && sources.get(clip.sourceId);
			return source && isControllerPcmSource(source) ? [source.channelCount] : [];
		}));
		if (sourceWidths.size > 1) throw new RangeError('Individual Mix & Render cannot preserve pre-fader routing on a track with changing channel widths. Choose Mix down instead.');
		if (width === 1 && renderEffects && track.effectsActive !== false && (track.effects ?? []).some(effect => {
			if (effect.type !== 'reverb' || effect.enabled === false || effect.bypassed === true) return false;
			const params = effect.params && typeof effect.params === 'object' && !Array.isArray(effect.params)
				? effect.params as Readonly<Record<string, unknown>> : {};
			return Number(params.mix ?? .2) > 0;
		})) throw new RangeError('Individual Mix & Render cannot preserve pre-fader routing on a mono track with stereo reverb. Choose Mix down instead.');
		const byEffects = results.get(track.id) ?? new Map<boolean, number>();
		byEffects.set(renderEffects, width); results.set(track.id, byEffects);
		return width;
	}
}

/** Change only the private capture: bake clips/rack, leaving authored strip controls live. */
type IndividualCaptureProject = Pick<MutableControllerProject, 'tracks' | 'clips' | 'sources'>
	& Record<string, unknown> & { mixer: unknown };

export function prepareIndividualPreFaderSnapshot(snapshot: IndividualCaptureProject, trackId: string, width: number, includeTrackPan = true): void {
	snapshot.tracks = snapshot.tracks.map(track => track.id === trackId ? { ...track, gain: 1, pan: 0 } : track);
	snapshot.automationLanes = automationLanes(snapshot).filter(lane => !isTrackStripLane(lane, trackId));
	// Mono is captured through the neutral stereo panner then folded back with the
	// existing equal-power normalizer. Wider prints must not first truncate at master.
	const captureWidth = includeTrackPan ? Math.max(2, width) : width;
	const graph = normalizeMixerGraphV21(snapshot.mixer);
	const widths = resolveTerminalChannelWidths({ tracks: snapshot.tracks, clips: snapshot.clips, sources: snapshot.sources }, captureWidth).tracks;
	snapshot.masterChannels = captureWidth;
	snapshot.mixer = normalizeMixerGraphV21({ ...graph,
		outputs: graph.outputs.map(output => output.role === 'main' ? { ...output, channelCount: captureWidth } : output),
		edges: graph.edges.map(edge => edge.destination.kind === 'master' ? { ...edge,
			channelMap: defaultMixerChannelMapV21(edge.source.kind === 'track'
				? widths.get(edge.source.id) ?? captureWidth : captureWidth, captureWidth),
		} : edge.source.kind === 'master' && edge.destination.kind === 'output'
			? { ...edge, channelMap: defaultMixerChannelMapV21(captureWidth, captureWidth) } : edge),
	});
}

export function retainIndividualStripControls(track: ControllerTrack): Record<string, unknown> {
	return { gain: track.gain ?? 1, pan: track.pan ?? 0, mute: track.mute ?? false, solo: track.solo ?? false };
}

export function individualPrintLaneCommands(project: ControllerProject, sourceId: string, targetId: string,
	createId: (prefix: string) => string): AudioEditorCommand[] {
	return printLaneCommands(automationLanes(project), sourceId, targetId, createId);
}

function printLaneCommands(lanes: readonly AutomationLaneV21[], sourceId: string, targetId: string,
	createId: (prefix: string) => string): AudioEditorCommand[] {
	return lanes.flatMap((lane): AudioEditorCommand[] => {
		if (sourceId === targetId) {
			if (lane.address.kind !== 'effect' || lane.address.strip.kind !== 'track' || lane.address.strip.id !== sourceId) return [];
			return [{ type: 'automation-lane/set', laneId: lane.id, expected: { ...lane }, lane: null }];
		}
		if (!isTrackStripLane(lane, sourceId) || lane.address.kind !== 'strip') return [];
		const copy = normalizeAutomationLaneV21({ ...lane, id: createId('automation-lane'),
			address: { ...lane.address, strip: { kind: 'track', id: targetId } },
			points: lane.points.map(point => ({ ...point, id: createId('automation-point') })),
		});
		return [{ type: 'automation-lane/set', laneId: copy.id, expected: null, lane: { ...copy } }];
	});
}

function isTrackStripLane(lane: AutomationLaneV21, trackId: string): boolean {
	return lane.address.kind === 'strip' && lane.address.strip.kind === 'track' && lane.address.strip.id === trackId;
}

function automationLanes(project: Readonly<Record<string, unknown>>): AutomationLaneV21[] {
	if (!Array.isArray(project.automationLanes)) throw new TypeError('A native individual print requires automationLanes.');
	return project.automationLanes.map(value => normalizeAutomationLaneV21(value));
}
