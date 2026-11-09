/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Rational } from '../common/editor/timeline-time.ts';
export { createMotionLayer } from '../common/editor/motion-layer-create.ts';
import { normalizeMotionscaperProject } from './editor-project-validation.ts';
import type { MotionscaperProject } from './editor-project-types.ts';

export type { MotionscaperProject } from './editor-project-types.ts';

export interface CreateMotionscaperProjectOptions {
	readonly id: string; readonly title: string; readonly compositionId: string;
	readonly width?: number; readonly height?: number; readonly frameRate?: Rational;
	readonly durationFrames?: number; readonly sampleRate?: number;
}

export function createMotionscaperProject(options: CreateMotionscaperProjectOptions): MotionscaperProject {
	return normalizeMotionscaperProject({
		schemaFamily: 'motionscaper', schemaVersion: 1, id: options.id, title: options.title, revision: 0,
		sampleRate: options.sampleRate ?? 48000, primaryCompositionId: options.compositionId, assets: [],
		compositions: [{ id: options.compositionId, name: options.title, width: options.width ?? 1920, height: options.height ?? 1080,
			frameRate: options.frameRate ?? { num: 30, den: 1 }, durationFrames: options.durationFrames ?? 300,
			background: [0, 0, 0, 0], color: { workingSpace: 'linear-rec709-d65', outputSpace: 'srgb', alphaMode: 'premultiplied' }, layers: [], audio: [] }],
	});
}
