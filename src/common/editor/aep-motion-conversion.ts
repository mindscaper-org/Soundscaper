/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AepLayer, NativeAepDocument } from './aep-project-reader.ts';
import { aepNamed } from './aep-project-reader.ts';
import { convertAepTransform, aepScalar, aepNumber, type AepConversionContext } from './aep-motion-transform.ts';
import { createMotionLayer } from './motion-layer-create.ts';
import { normalizeMotionscaperProject } from './motion-project-validation.ts';
import type { MotionscaperProject } from './motion-project-types.ts';
import type { MotionAsset } from './motion-asset.ts';
import type { MotionComposition, MotionLayer, MotionLayerContent } from './motion-composition.ts';
import type { MotionNativeImportEntry } from './motion-native-import-custody.ts';
import { motionAeBoundedClock } from './motion-bounded-clock.ts';
import { decodeMotionChannel } from './motion-surface.ts';
import { motionColor, motionScalar, motionVector } from './motion-property.ts';
import type { MotionScalarProperty } from './motion-property.ts';
import { motionId } from './motion-values.ts';
import { convertAepShapes } from './aep-motion-shapes.ts';
import { convertAepText, offsetAepTextAnchor, type NativeAepFontBinding } from './aep-motion-text.ts';
import { convertAepMasks } from './aep-motion-masks.ts';
import { materializeAepMattes } from './aep-motion-mattes.ts';
export interface NativeAepMediaBinding { readonly sourceId: number; readonly asset: MotionAsset }
export interface NativeAepConversionOptions {
	readonly projectId: string; readonly title: string; readonly source: Extract<MotionAsset, { kind: 'attachment' }>;
	readonly allocateId: () => string; readonly media: readonly NativeAepMediaBinding[]; readonly primaryCompositionId?: number;
	readonly fonts?: readonly NativeAepFontBinding[];
}
export function aepCanonicalLabel(value: string, fallback: string): string {
	return value.normalize('NFC').replace(/[\p{Cc}]/gu, ' ').slice(0, 512) || fallback;
}
/** Direct project reconstruction; no installed Adobe host, script or interchange manifest participates. */
export function convertNativeAep(document: NativeAepDocument, options: NativeAepConversionOptions): MotionscaperProject {
	const report: MotionNativeImportEntry[] = [], used = new Set([motionId(options.projectId), options.source.id]);
	const ids = new Map<number, string>(), media = new Map(options.media.map(binding => [binding.sourceId, binding.asset]));
	const context: AepConversionContext = { report, budget: { keys: 0 }, numeric: new WeakMap(), allocateId: () => {
		const id = motionId(options.allocateId()); if (used.has(id)) throw new TypeError('Native AEP destination identity is duplicated.'); used.add(id); return id;
	}, note(scopeId, propertyPath, code, message, status = 'unsupported') {
		if (report.length >= 65_536) throw new RangeError('Native AEP conversion report budget exceeded.');
		report.push({ scopeId, propertyPath, code, message, status });
	} };
	for (const binding of options.media) { if (used.has(binding.asset.id)) throw new TypeError('Native AEP media identity is duplicated.'); used.add(binding.asset.id); }
	const fontNames = new Set<string>();
	for (const binding of options.fonts ?? []) { if (used.has(binding.asset.id) || fontNames.has(binding.postScriptName)) throw new TypeError('Native AEP font identity is duplicated.'); used.add(binding.asset.id); fontNames.add(binding.postScriptName); }
	for (const comp of document.compositions) ids.set(comp.id, context.allocateId());
	context.note('native-source', '', 'native-aep', `Native ${document.format.toUpperCase()} import decoded ${String(document.compositions.length)} compositions. Original project bytes remain in this document.`, 'editable');
	context.note('native-source', '', 'rendering', 'Motion renders in linear Rec.709/sRGB. After Effects color management, motion blur, plug-ins and some compositing features can differ. Review every unsupported entry.');
	context.note('native-source', '', 'clock-precision', 'Fractional frame and second values are bounded to six decimal places; integer frame counts and recovered NTSC composition rates remain exact.', 'sampled');
	const compositions = document.compositions.map(comp => {
		const scope = `item-${String(comp.id)}`, layerIds = new Map<number, string>(), footage = new Map(document.footage.map(source => [source.id, source]));
		for (const layer of comp.layers) { if (layerIds.has(layer.id)) throw new TypeError('AEP layer identity is duplicated.'); layerIds.set(layer.id, context.allocateId()); }
		if (comp.pixelAspect !== 1) context.note(scope, 'pixelAspect', 'pixel-aspect', 'Non-square-pixel source geometry is retained in the AEP; this composition uses square pixels.');
		if (comp.motionBlur) context.note(scope, 'motionBlur', 'motion-blur', 'AE shutter sampling is retained in the original AEP and needs separate render review.');
		const hasSolo = comp.layers.some(layer => layer.solo);
		function content(layer: AepLayer): MotionLayerContent {
			const owner = `${scope}-layer-${String(layer.id)}`, source = footage.get(layer.sourceId), asset = media.get(layer.sourceId);
			if (layer.nullLayer) return { kind: 'null' };
			const vectors = aepNamed(layer.properties, 'ADBE Root Vectors Group');
			if (layer.kind === 4 && vectors) {
				try { return convertAepShapes(vectors, owner, context); }
				catch (error) { context.note(owner, 'ADBE Root Vectors Group', 'shape', error instanceof Error ? error.message : String(error)); return { kind: 'null' }; }
			}
			if (layer.adjustment) { context.note(owner, '', 'adjustment', 'The adjustment layer and its effects remain in the source AEP. A named null preserves its hierarchy.'); return { kind: 'null' }; }
			if (layer.kind === 0 && ids.has(layer.sourceId)) return { kind: 'precomp', compositionId: ids.get(layer.sourceId)! };
			if (layer.kind === 0 && source?.color) return { kind: 'solid', color: motionColor([decodeMotionChannel(source.color[0], 'srgb'), decodeMotionChannel(source.color[1], 'srgb'), decodeMotionChannel(source.color[2], 'srgb'), source.color[3]]), size: motionVector([source.width, source.height]) };
			if (layer.kind === 0 && source) {
				if (asset?.kind === 'image') return { kind: 'image', assetId: asset.id };
				if (asset?.kind === 'footage') return { kind: 'footage', assetId: asset.id, audioEnabled: false, audioGain: motionScalar(1) };
				context.note(owner, '', 'missing-media', source.sequence ? 'Image-sequence collection is not yet mapped. Every original source reference remains in the retained AEP.' : `Select the original media for ${aepCanonicalLabel(source.name, 'this source')} to replace this named null.`); return { kind: 'null' };
			}
			context.note(owner, '', 'layer-content', `AE layer type ${String(layer.kind)} has no editable content mapping in this import. Its original data is retained.`); return { kind: 'null' };
		}
		const layers = comp.layers.map(layer => {
			const owner = `${scope}-layer-${String(layer.id)}`, source = footage.get(layer.sourceId), nested = document.compositions.find(item => item.id === layer.sourceId);
			const size: readonly [number, number] = [source?.width ?? nested?.width ?? comp.width, source?.height ?? nested?.height ?? comp.height];
			const text = layer.kind === 3 ? convertAepText(layer, comp, options.fonts ?? [], context) : null;
			const base = createMotionLayer({ id: layerIds.get(layer.id)!, name: aepCanonicalLabel(layer.name || source?.name || nested?.name || '', 'Layer'), durationFrames: comp.durationFrames, content: text?.content ?? content(layer) });
			const known = new Set(['ADBE Transform Group', 'ADBE Time Remapping', 'ADBE Mask Parade', ...(layer.kind === 4 ? ['ADBE Root Vectors Group'] : []), ...(layer.kind === 3 ? ['ADBE Text Properties'] : [])]);
			for (const entry of layer.properties) if (!known.has(entry.name) && (entry.chunk.children?.length || entry.chunk.data.length)) context.note(owner, entry.name, 'property-group', 'This AE property group remains in the original source and is not applied to the imported draft.');
			const blend: Readonly<Record<number, MotionLayer['blendMode']>> = { 2: 'normal', 4: 'add', 5: 'multiply', 6: 'screen', 7: 'overlay', 10: 'darken', 11: 'lighten', 25: 'exclusion', 26: 'difference' };
			if (!blend[layer.blend]) context.note(owner, 'blend', 'blend-mode', 'This blend mode is unsupported. The imported draft uses normal blending.');
			if (layer.audioEnabled && !source?.color && layer.kind === 0 && source && source.duration > 0) context.note(owner, 'audio', 'audio', 'Source audio is retained when supplied but muted in this draft; AE audio levels and interpretation require a separate mapping.');
			if (layer.collapse && layer.kind === 0) context.note(owner, 'collapse', 'collapse-transform', 'Collapse Transformations requires separate review; the imported precomposition uses Motion compositing.');
			if (layer.parentId && !layerIds.has(layer.parentId)) throw new TypeError('AEP layer parent identity is unresolved.');
			const matteMode = ({ 1: 'alpha', 2: 'alpha-inverted', 3: 'luma', 4: 'luma-inverted' } as const)[layer.matte?.mode as 1];
			const matteId = layer.matte && layerIds.get(layer.matte.id);
			if (layer.matte && (!matteMode || !matteId)) context.note(owner, 'matte', 'matte', 'The native track-matte source or mode could not be resolved. Its intent remains in the AEP.');
			let remapped: MotionScalarProperty | null = null;
			try { if (aepNumber(layer.properties, 'ADBE Time Remapping', context)) remapped = aepScalar(layer.properties, 'ADBE Time Remapping', 0, 1, 0, layer, comp, context); }
			catch (error) { if (error instanceof RangeError) throw error; context.note(owner, 'ADBE Time Remapping', 'time-remap', String(error)); }
			const transform = convertAepTransform(layer, comp, size, context);
			const adjusted = text?.content.kind === 'text' ? { ...transform, anchor: offsetAepTextAnchor(transform.anchor, text.offset) } : transform;
			return { ...base, enabled: layer.enabled && (!hasSolo || layer.solo), is3D: layer.threeD, parentId: layer.parentId ? layerIds.get(layer.parentId)! : null,
				inFrame: motionAeBoundedClock(layer.inPoint * comp.storedRate).value, outFrame: motionAeBoundedClock(layer.outPoint * comp.storedRate).value,
				sourceStart: motionAeBoundedClock(-layer.start / layer.stretch).value, timeScale: motionAeBoundedClock(1 / layer.stretch).value,
				transform: adjusted, blendMode: blend[layer.blend] ?? 'normal', timeRemap: remapped,
				masks: convertAepMasks(layer, comp, size, context), matte: matteMode && matteId ? { layerId: matteId, mode: matteMode } : null };
		});
		return { id: ids.get(comp.id)!, name: aepCanonicalLabel(comp.name, 'Composition'), width: comp.width, height: comp.height, frameRate: comp.frameRate, durationFrames: comp.durationFrames,
			background: [0, 0, 0, 0], color: { workingSpace: 'linear-rec709-d65', outputSpace: 'srgb', alphaMode: 'premultiplied' }, layers: materializeAepMattes(layers, scope, context), audio: [],
			...(comp.workArea ? { workArea: { startFrame: motionAeBoundedClock(comp.workArea[0]).value, endFrame: motionAeBoundedClock(comp.workArea[1]).value } } : {}) } satisfies MotionComposition;
	});
	const primary = options.primaryCompositionId ?? document.compositions[0]!.id;
	if (!ids.has(primary)) throw new TypeError('Choose a composition present in this AEP.');
	return normalizeMotionscaperProject({ schemaFamily: 'motionscaper', schemaVersion: 1, id: options.projectId, title: aepCanonicalLabel(options.title, 'After Effects project'), revision: 0,
		sampleRate: 48000, primaryCompositionId: ids.get(primary), assets: [options.source, ...options.media.map(binding => binding.asset), ...(options.fonts ?? []).map(binding => binding.asset)], compositions,
		nativeImport: { format: 'org.motionscaper.native-aep-import', version: 1, sourceAssetId: options.source.id, sourceFormat: document.format, report } });
}
