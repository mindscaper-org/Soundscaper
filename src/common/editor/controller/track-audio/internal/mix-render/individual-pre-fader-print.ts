/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21, type AutomationLaneV21 } from '../../../../automation-lane-v21.ts';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { defaultMixerChannelMapV21, normalizeMixerGraphV21 } from '../../../../mixer-graph-v21.ts';
import { mixerEdgeCarriesSignalV21 } from '../../../../mixer-signal-edge-v21.ts';
import { isSoundscaperProductionProject } from '../../../../project-schema-version.ts';
import { resolveTerminalChannelWidths } from '../../../../terminal-channel-widths.ts';
import { findControllerClip, findControllerSource, type ControllerProject, type ControllerTrack, type MutableControllerProject } from '../../track-domain-types.ts';

/** A retained pre-fader tap needs a print before the controls that distinguish both taps. */
export function individualPreFaderPrintWidth(project: ControllerProject, track: ControllerTrack, renderEffects = true): number | null {
	if (!isSoundscaperProductionProject(project)) return null;
	const graph = normalizeMixerGraphV21(project.mixer);
	const lanes = automationLanes(project);
	const carriesPre = graph.edges.some(edge => edge.source.kind === 'track' && edge.source.id === track.id
		&& edge.position === 'pre-fader' && mixerEdgeCarriesSignalV21(edge)
		&& (edge.level > 0 || lanes.some(lane => lane.address.kind === 'edge' && lane.address.edgeId === edge.id
			&& lane.points.some(point => point.value > 0))));
	if (!carriesPre) return null;
	const width = resolveTerminalChannelWidths(project, Number(project.masterChannels)).tracks.get(track.id)!;
	const sourceWidths = new Set((track.clipIds ?? []).flatMap(id => {
		const clip = findControllerClip(project, id);
		const source = clip && findControllerSource(project, clip.sourceId);
		return source ? [source.channelCount] : [];
	}));
	if (sourceWidths.size > 1) throw new RangeError('Individual Mix & Render cannot preserve pre-fader routing on a track with changing channel widths. Choose Mix down instead.');
	if (width === 1 && renderEffects && track.effectsActive !== false && (track.effects ?? []).some(effect => {
		if (effect.type !== 'reverb' || effect.enabled === false || effect.bypassed === true) return false;
		const params = effect.params && typeof effect.params === 'object' && !Array.isArray(effect.params)
			? effect.params as Readonly<Record<string, unknown>> : {};
		return Number(params.mix ?? .2) > 0;
	})) throw new RangeError('Individual Mix & Render cannot preserve pre-fader routing on a mono track with stereo reverb. Choose Mix down instead.');
	return width;
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
	return automationLanes(project).flatMap((lane): AudioEditorCommand[] => {
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
