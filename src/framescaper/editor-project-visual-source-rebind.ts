/* SPDX-License-Identifier: AGPL-3.0-only */

import { fingerprintNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';

import { rebindFramescaperMulticameraSourceIdentitiesSequence } from './editor-multicamera-source-rebind-sequence.ts';

/** Follow Scape source collision remaps through every visual-owned source reference. */
export function rebindFramescaperVisualSourceIdentitiesVisual(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperMulticameraSourceIdentitiesSequence(project, sourceIdMap);
	if (![...sourceIdMap].some(([before, after]) => before !== after)) return;
	const presets = records(project.videoVisualPresets);
	const originalIds = new Map([...sourceIdMap].map(([before, after]) => [after, before]));
	if (Array.isArray(project.videoMaskMattes)) {
		for (const graph of project.videoMaskMattes as Record<string, unknown>[]) {
			if (!Array.isArray(graph.inputs)) continue;
			graph.inputs = (graph.inputs as Record<string, unknown>[]).map((input) => ({
				...input,
				sourceRef: sourceIdMap.get(String(input.sourceRef)) ?? input.sourceRef,
			}));
		}
	}
	if (Array.isArray(project.videoFreezeFallbacks)) {
		project.videoFreezeFallbacks = (project.videoFreezeFallbacks as Record<string, unknown>[])
			.map((fallback) => ({
				...fallback,
				renderedSourceId: sourceIdMap.get(String(fallback.renderedSourceId))
					?? fallback.renderedSourceId,
			}));
	}
	if (Array.isArray(project.sources)) {
		for (const source of project.sources as Record<string, unknown>[]) {
			const generator = source.generator as Record<string, unknown> | undefined;
			if (source.kind !== 'generator' || !generator) continue;
			// The archive importer has already replaced the source's own identity.
			const bound = boundPresets(presets, 'generator', {
				...source, id: originalIds.get(String(source.id)) ?? source.id,
			});
			if (generator.kind === 'sound-visualizer' && Array.isArray(generator.sourceIds)) {
				generator.sourceIds = generator.sourceIds.map((id: unknown) => sourceIdMap.get(String(id)) ?? id);
			} else if (generator.kind === 'external-generator' && Array.isArray(generator.inputs)) {
				generator.inputs = (generator.inputs as Record<string, unknown>[]).map((input) => ({
					...input,
					sourceRef: sourceIdMap.get(String(input.sourceRef)) ?? input.sourceRef,
				}));
			}
			refreshPresets(bound, source);
		}
	}
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter((item: unknown): item is Record<string, unknown> =>
		item !== null && typeof item === 'object' && !Array.isArray(item)) : [];
}

function boundPresets(
	presets: Record<string, unknown>[], modelKind: string, model: Record<string, unknown>,
): Record<string, unknown>[] {
	const candidates = presets.filter(preset => preset.modelKind === modelKind);
	if (!candidates.length) return [];
	const digest = fingerprintNativeMediaPlan(model).sha256;
	return candidates.filter(preset => preset.authoredStateSha256 === digest);
}

function refreshPresets(presets: Record<string, unknown>[], model: Record<string, unknown>): void {
	if (!presets.length) return;
	const digest = fingerprintNativeMediaPlan(model).sha256;
	for (const preset of presets) preset.authoredStateSha256 = digest;
}
