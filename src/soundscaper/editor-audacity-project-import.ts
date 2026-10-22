/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV17,
	type AudioEditorProjectV17,
} from '../common/editor/project-v17.ts';
import {
	createSoundscaperProject,
	type SoundscaperProjectOptions,
} from './editor-project.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import { AUTOMATION_LANE_MAXIMUM_POINTS_V21, normalizeAutomationLaneV21, type AutomationLaneV21 } from '../common/editor/automation-lane-v21.ts';
import { thinAutomationLaneCaptureV21 } from '../common/editor/automation-lane-thinning-v21.ts';
import type { StripRef } from '../common/editor/parameter-address.ts';
import { importSoundscaperAudacityMixer } from './editor-audacity-import-mixer.ts';
import type { DawprojectImportRoutingContext } from '../common/editor/dawproject-import-structure.ts';

/** Promote maintained Audacity decoder output into the baseline family. */
export function importSoundscaperAudacityProject(value: unknown, context?: DawprojectImportRoutingContext): SoundscaperProject {
	validateAudioEditorProjectV17(value);
	const decoded = structuredClone(value) as AudioEditorProjectV17;
	const foundation = { ...decoded } as Record<string, unknown>;
	delete foundation.mixer;
	delete foundation.schemaFamily;
	delete foundation.schemaVersion;
	const options = {
		...foundation,
		automationLanes: importedStripGainLanes(decoded),
		now: decoded.createdAt,
	} as SoundscaperProjectOptions;
	// Establish imported bus identities before validating their gain lanes.
	const imported = createSoundscaperProject({ ...options, automationLanes: [] });
	return createSoundscaperProject({ ...options, mixer: importSoundscaperAudacityMixer(decoded, imported, context) });
}

/** Legacy strip envelopes multiply the fader; baseline gain lanes are absolute. */
function importedStripGainLanes(project: AudioEditorProjectV17): readonly AutomationLaneV21[] {
	const lanes: AutomationLaneV21[] = [];
	for (const track of project.tracks) {
		if (track.type === 'audio') add({ kind: 'track', id: track.id }, track);
	}
	add({ kind: 'master' }, project.master);
	for (const bus of [...project.mixer.groups, ...project.mixer.sends]) {
		add({ kind: 'mixer-node', id: bus.id }, bus);
	}
	return lanes;

	function add(strip: StripRef, owner: Readonly<{ gain: number; envelope?: readonly Readonly<{ frame: number; value: number }>[] }>): void {
		if (!owner.envelope?.length) return;
		const id = `imported-volume:${String(lanes.length + 1)}`;
		const points = owner.envelope.map((point, index) => ({
			id: `${id}:${String(index + 1)}`, position: point.frame, value: owner.gain * point.value,
		}));
		// A legacy envelope ramps from unity when its first point is after zero.
		if (points[0]!.position > 0) points.unshift({ id: `${id}:start`, position: 0, value: owner.gain });
		const lane = {
			id, address: { kind: 'strip', strip, parameterId: 'gain' }, timebase: 'absolute-samples', points,
			segments: points.slice(1).map(() => ({ kind: 'linear' })),
		};
		// External envelopes may sample a simple ramp thousands of times. Keep
		// endpoints and reject curves that cannot satisfy this strict gain error.
		lanes.push(points.length > AUTOMATION_LANE_MAXIMUM_POINTS_V21
			? thinAutomationLaneCaptureV21(lane, { automationTolerance: 1e-9 })
			: normalizeAutomationLaneV21(lane));
	}
}
