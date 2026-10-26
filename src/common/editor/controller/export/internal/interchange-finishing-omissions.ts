/* SPDX-License-Identifier: AGPL-3.0-only */

type Data = Readonly<Record<string, unknown>>;

/** Inventory native finishing attached to a retained cut, rather than dormant project assets. */
export function createInterchangeFinishingOmissions(project: Data, tracks: readonly Data[]) {
	const presentations = records(project.videoVisualPresentations).filter(value => value.enabled === true);
	const layers = new Map(records(project.videoAdjustmentLayers).map(value => [value.id, value]));
	const stacks = new Map(records(project.videoProcessorStacks).map(value => [value.id, value]));
	const owners = new Map(tracks.flatMap(track => Array.isArray(track.clipIds)
		? track.clipIds.map(id => [id, track.id] as const) : []));
	return (clip: Data): Data => {
		const masks = new Set<string>(), compositing = new Set<string>(), grades = new Set<string>(), processors = new Set<string>();
		for (const presentation of presentations) {
			if (!applies(presentation, clip, owners.get(clip.id), layers)) continue;
			const id = String(presentation.id);
			for (const mask of Array.isArray(presentation.maskMatteIds) ? presentation.maskMatteIds : []) masks.add(String(mask));
			if (presentation.opacity !== 1 || presentation.blendMode !== 'normal') compositing.add(id);
			if (presentation.grade != null) grades.add(id);
			const stack = stacks.get(presentation.processorStackId);
			if (stack && records(stack.processors).some(value => value.enabled === true && value.kind !== 'tracking')) {
				processors.add(String(stack.id));
			}
		}
		return {
			...(masks.size ? { videoMaskMattes: [...masks].sort() } : {}),
			...(compositing.size ? { videoVisualPresentations: [...compositing].sort() } : {}),
			...(grades.size ? { videoColorGrades: [...grades].sort() } : {}),
			...(processors.size ? { videoProcessorStacks: [...processors].sort() } : {}),
		};
	};
}

function applies(presentation: Data, clip: Data, trackId: unknown, layers: ReadonlyMap<unknown, Data>): boolean {
	const owner = isRecord(presentation.owner) ? presentation.owner : {};
	if (owner.kind === 'clip') return owner.id === clip.id;
	if (owner.kind === 'source') return owner.id === clip.sourceId;
	if (owner.kind !== 'adjustment-layer') return false;
	const layer = layers.get(owner.id);
	if (!layer || layer.sequenceId !== clip.sequenceId || !Array.isArray(layer.targetTrackIds)
		|| !layer.targetTrackIds.includes(trackId)) return false;
	const start = clip.sequenceStartFrame, count = clip.sequenceFrameCount;
	const layerStart = layer.sequenceStartFrame, layerCount = layer.sequenceFrameCount;
	return typeof start === 'number' && typeof count === 'number'
		&& typeof layerStart === 'number' && typeof layerCount === 'number'
		&& start < layerStart + layerCount && layerStart < start + count;
}

function records(value: unknown): readonly Data[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}
function isRecord(value: unknown): value is Data {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
