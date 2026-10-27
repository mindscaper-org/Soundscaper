/* SPDX-License-Identifier: AGPL-3.0-only */

import { countAudioEditorProjectValidationStructure, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS } from '../project-validation-budget.ts';
import { MAXIMUM_VIDEO_KEYFRAME_ANCHORS } from '../video-keyframe-curves.ts';
import type { Rational } from '../timeline-time.ts';
import type { AssistanceReframePathKeyframeV1 } from './visual-semantic-results-v1.ts';

type Data = Readonly<Record<string, unknown>>;
export interface ReframePublicationCrop { readonly position: Rational; readonly crop: AssistanceReframePathKeyframeV1['crop'] }
const PARAMETERS = ['left', 'right', 'top', 'bottom'] as const;

/** Reserve four complete linear curves before decoding or running any local models. */
export function reframePublicationSampleBudget(project: Data, clip: Data): number {
	if (!Array.isArray(project.clips)) throw new TypeError('Reframe capacity requires a project clip inventory.');
	const keyframes = clip.videoKeyframes as Data;
	const curves = keyframes.curves as readonly Data[];
	const retained = curves.filter(curve => {
		const target = curve.target as Data;
		return target.kind !== 'composition' || !PARAMETERS.some(parameter => target.parameterId === `crop.${parameter}`);
	});
	const base = { ...project, clips: (project.clips as readonly Data[]).map(candidate => candidate.id === clip.id
		? { ...candidate, videoKeyframes: { ...keyframes, curves: retained } } : candidate) };
	const nodes = countAudioEditorProjectValidationStructure(base, AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS);
	// Each anchor uses five JSON nodes and its linear segment two, in each of
	// four curves. Reserve the wrappers and feature-requirement publication too.
	const capacity = Math.min(MAXIMUM_VIDEO_KEYFRAME_ANCHORS, Math.floor((AUDIO_EDITOR_PROJECT_VALIDATION_HARD_LIMITS.maximumTraversalNodes - nodes - 256) / 28));
	if (capacity < 2) throw new RangeError('Reframe needs room in the project for at least two crop anchors before analysis.');
	return capacity;
}

/** Preserve every shot anchor and both ends while distributing the remaining cadence across the full clip. */
export function fitReframeSampleFrames(frames: readonly number[], anchors: readonly number[], maximum: number): readonly number[] {
	if (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > 100_000) throw new RangeError('Reframe publication sample capacity is invalid.');
	if (frames.length <= maximum) return frames;
	const mandatory = new Set([frames[0]!, frames.at(-1)!, ...anchors]);
	if (mandatory.size > maximum) throw new RangeError('The selected Reframe shot anchors exceed the project crop capacity; select a shorter range.');
	const candidates = frames.filter(frame => !mandatory.has(frame));
	const remaining = maximum - mandatory.size;
	for (let ordinal = 0; ordinal < remaining; ordinal += 1) mandatory.add(candidates[Math.floor((ordinal + 0.5) * candidates.length / remaining)]!);
	return Object.freeze([...mandatory].sort((left, right) => left - right));
}

/** Constant spans have exactly the same evaluated crop without their redundant interior keys. */
export function compactReframePublicationCrops(crops: readonly ReframePublicationCrop[]): readonly ReframePublicationCrop[] {
	if (crops.length < 2) return crops;
	const same = (left: ReframePublicationCrop, right: ReframePublicationCrop) => PARAMETERS.every(parameter => Object.is(left.crop[parameter], right.crop[parameter]));
	if (crops.every(crop => same(crops[0]!, crop))) return Object.freeze([crops[0]!]);
	return Object.freeze(crops.filter((crop, index) => index === 0 || index === crops.length - 1
		|| !same(crops[index - 1]!, crop) || !same(crop, crops[index + 1]!)));
}
