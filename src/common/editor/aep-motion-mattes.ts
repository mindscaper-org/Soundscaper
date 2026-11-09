/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionLayer } from './motion-composition.ts';
import type { AepConversionContext } from './aep-motion-transform.ts';
import { compareRationals } from './timeline-time.ts';
/** AE evaluates matte pixels independently of source visibility. Motion consumes active, hidden matte copies. */
export function materializeAepMattes(layers: readonly MotionLayer[], scope: string, context: AepConversionContext): readonly MotionLayer[] {
	const byId = new Map(layers.map(layer => [layer.id, layer])), copies: MotionLayer[] = [];
	function bind(consumer: MotionLayer, depth: number): MotionLayer {
		if (!consumer.matte) return consumer;
		if (depth > 32 || layers.length + copies.length >= 4096) throw new RangeError('Native AEP matte copies exceed their layer/depth budget.');
		const source = byId.get(consumer.matte.layerId); if (!source) throw new TypeError('Native AEP matte source is unresolved.');
		if (['null', 'camera', 'light', 'adjustment'].includes(source.kind)) {
			context.note(scope, 'matte', 'matte', 'This matte source has no imported pixel content. The matte is not applied; restore its source content and review the original intent.');
			return { ...consumer, matte: null };
		}
		const inFrame = compareRationals(source.inFrame, consumer.inFrame) >= 0 ? source.inFrame : consumer.inFrame;
		const outFrame = compareRationals(source.outFrame, consumer.outFrame) <= 0 ? source.outFrame : consumer.outFrame;
		const overlaps = compareRationals(inFrame, outFrame) < 0;
		const copy: MotionLayer = { ...source, id: context.allocateId(), name: `${source.name.slice(0, 460)} (AE matte copy)`, enabled: consumer.enabled && overlaps,
			inFrame: overlaps ? inFrame : source.inFrame, outFrame: overlaps ? outFrame : source.outFrame };
		const index = copies.length; copies.push(copy); copies[index] = bind(copy, depth + 1);
		context.note(scope, 'matte', 'editable-matte', 'An independent editable matte copy preserves the original source visibility and this consumer span. Review timing when editing either layer.', 'editable');
		return { ...consumer, matte: { ...consumer.matte, layerId: copy.id } };
	}
	const result = layers.map(layer => bind(layer, 0)); return [...result, ...copies];
}
