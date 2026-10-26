/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeVideoMaskMatteGraphV1, type VideoMaskMatteGraphV1 } from './video-mask-matte-v24.ts';

/** A shape editor changes its output shape without reconstructing the owning graph. */
export function authorSelectedMaskShape(request: Readonly<{
	readonly maskId: string;
	readonly current: unknown;
	readonly nodeId: () => string;
	readonly shape: string;
	readonly width: number;
	readonly height: number;
}>): VideoMaskMatteGraphV1 {
	const current = request.current === null ? null : normalizeVideoMaskMatteGraphV1(request.current);
	const output = current?.nodes.find(node => node.id === current.outputNodeId);
	if (current && output?.kind !== 'vector-shape') {
		throw new Error('The selected mask graph is not editable by the shape editor.');
	}
	const shape = output?.kind === 'vector-shape'
		? { ...output, shape: request.shape, width: request.width, height: request.height }
		: { id: request.nodeId(), kind: 'vector-shape', shape: request.shape,
			x: (1 - request.width) / 2, y: (1 - request.height) / 2, width: request.width, height: request.height };
	return normalizeVideoMaskMatteGraphV1(current
		? { ...current, nodes: current.nodes.map(node => node.id === current.outputNodeId ? shape : node) }
		: { schemaVersion: 1, id: request.maskId, kind: 'mask', inputs: [], nodes: [shape], outputNodeId: shape.id });
}
