/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayer, MotionLayerContent } from './motion-composition.ts';
import { motionScalar, motionVector } from './motion-property.ts';
import { normalizeMotionLayer } from './motion-layer-validation.ts';
export function createMotionLayer(options: Readonly<{ id: string; name: string; durationFrames: number; content: MotionLayerContent }>): MotionLayer {
	return normalizeMotionLayer({
		id: options.id, name: options.name, enabled: true, parentId: null,
		startFrame: { num: 0, den: 1 }, inFrame: { num: 0, den: 1 }, outFrame: { num: options.durationFrames, den: 1 },
		sourceStart: { num: 0, den: 1 }, timeScale: { num: 1, den: 1 }, timeRemap: null,
		transform: { anchor: motionVector([0, 0, 0]), position: motionVector([0, 0, 0]), scale: motionVector([1, 1, 1]), rotation: motionVector([0, 0, 0]), opacity: motionScalar(1) },
		is3D: false, material: { acceptsLights: true, castsShadows: false, receivesShadows: true,
			ambient: motionScalar(1), diffuse: motionScalar(1), specular: motionScalar(0), shininess: motionScalar(32) },
		blendMode: 'normal', masks: [], matte: null, effects: [], ...options.content,
	});
}
