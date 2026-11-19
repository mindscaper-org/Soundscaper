/* SPDX-License-Identifier: AGPL-3.0-only */
import { defaultImageDevelopStateV2 } from '../../../src/common/editor/imaging/image-develop-state-v2.ts';
import { normalizeImageDevelopStateV4, type ImageDevelopStateV4 } from '../../../src/common/editor/imaging/image-develop-state-v4.ts';
import { parseCubeLutV1 } from '../../../src/common/imaging/cube-lut-v1.ts';
import { withPreparedBrushMaskResourceV1 } from '../../../src/common/editor/imaging/brush-mask-resource-v1.ts';
import type { CubeLutSourcePortV1 } from '../../../src/common/editor/imaging/cube-lut-source-port-v1.ts';
import type { MaskRasterSourcePortV1 } from '../../../src/common/editor/imaging/mask-raster-source-port-v1.ts';
import { gpuLutTextCurrentV1 } from './lightscaper-native-gpu-lut-current-reference.ts';

export type FullStackModeCurrentV1 = 'canonical' | 'headroom' | 'recovery';
export type FullStackFaultCurrentV1 = 'none' | 'corrupt-lut' | 'corrupt-brush' | 'held-resource-abort' | 'held-consumer-abort';
export const fullStackRetiredCurrentV1 = (backing: ArrayBuffer) => backing.byteLength === 0 || new Uint8Array(backing).every(byte => byte === 0);
export function fullStackGateCurrentV1() {
	let resolve!: () => void;
	const promise = new Promise<void>(yes => { resolve = yes; });
	return { promise, resolve };
}

/** Real canonical LUT text and canonical brush bytes. Their normal production
 * parsers authenticate every borrow; these ports grant no positive verifier. */
export async function fullStackSceneCurrentV1(mode: FullStackModeCurrentV1, colorControl = false) {
	const text = gpuLutTextCurrentV1('swap2'), lut = parseCubeLutV1(text), lutBytes = new TextEncoder().encode(text);
	const lutReference = Object.freeze({ storageKey: `lut-sha256:${lut.sha256}`, sha256: lut.sha256, byteLength: lut.byteLength,
		size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax });
	const alpha = Uint8Array.of(0, 64, 192, 255, 255, 128, 32, 0);
	const brush = await withPreparedBrushMaskResourceV1({ width: 4, height: 2, alpha }, value => ({ reference: value.reference, bytes: value.bytes.slice() }));
	alpha.fill(0);
	const selection = Object.freeze({ maskId: 'combined', effectId: 'tone' });
	const complete = normalizeImageDevelopStateV4({ ...defaultImageDevelopStateV2(), processVersion: 4,
		rawDevelopment: { schemaVersion: 1, mode },
		repairs: { schemaVersion: 1, spots: [{ id: 'clone', mode: 'clone', enabled: true,
			target: mode === 'canonical' ? { x: .75, y: .75 } : { x: 55.5 / 96, y: 72.5 / 128 },
			source: mode === 'canonical' ? { x: .25, y: .75 } : { x: 55.5 / 96, y: 12.5 / 128 }, radius: .04, feather: .25, opacity: .5 }] },
		effects: [
			{ id: 'wb', type: 'white-balance-v1', enabled: true, params: { temperature: 25, tint: -12.5 } },
			{ id: 'lens', type: 'lens-distortion-v1', enabled: true, params: { amount: -25 } },
			{ id: 'crop', type: 'develop-geometry-v1', enabled: true, params: { cropX: .125, cropY: .125, cropWidth: .75, cropHeight: .75 } },
			{ id: 'tone', type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } },
			{ id: 'lut', type: 'cube-lut-profile-v1', enabled: true, params: { lut: lutReference } },
			{ id: 'ca', type: 'chromatic-aberration-v1', enabled: true, params: { red: 25, blue: -25 } },
			{ id: 'fringe', type: 'defringe-v1', enabled: true, params: { purple: 25, green: 25, edgeThreshold: 25 } },
			{ id: 'optical', type: 'optical-vignette-v1', enabled: true, params: { amount: -25 } },
			{ id: 'clarity', type: 'clarity-v1', enabled: true, params: { amount: 12.5 } },
			{ id: 'turn', type: 'develop-geometry-v1', enabled: true, params: { rotationDegrees: 90, flipHorizontal: 1 } },
		], masks: [{ schemaVersion: 1, id: 'combined', kind: 'mask', inputs: [{ name: 'paint', kind: 'alpha', sourceRef: brush.reference.storageKey }],
			nodes: [{ id: 'paint', kind: 'alpha', inputName: 'paint' },
				{ id: 'range', kind: 'luminance-range', lower: .125, upper: .875, falloff: .125 },
				{ id: 'both', kind: 'boolean', operation: 'intersect', inputNodeIds: ['paint', 'range'] }], outputNodeId: 'both' }],
		maskBindings: [{ ...selection }, { maskId: 'combined', effectId: 'lut' }, { maskId: 'combined', effectId: 'clarity' }],
	});
	// A separate genuine GPU control retains RAW, Clone, color, LUT, masks and
	// geometry. The complete scene above also exercises nonlinear resampling.
	const recipe = colorControl ? normalizeImageDevelopStateV4({ ...complete,
		effects: complete.effects.filter(effect => !['lens', 'ca', 'fringe', 'optical', 'clarity'].includes(effect.id)),
		maskBindings: complete.maskBindings.filter(binding => binding.effectId !== 'clarity'),
	}) : complete;
	let fault: FullStackFaultCurrentV1 = 'none', active = 0, calls = 0;
	const copies: ArrayBuffer[] = [], entered = fullStackGateCurrentV1(), release = fullStackGateCurrentV1();
	const source: CubeLutSourcePortV1 = { async withBytes(reference, consume, options) {
		if (this !== source || reference.sha256 !== lutReference.sha256) throw new TypeError('Combined LUT authority or receiver changed.');
		options?.signal?.throwIfAborted(); active++; calls++;
		const bytes = lutBytes.slice(); copies.push(bytes.buffer);
		try {
			if (fault === 'corrupt-lut') bytes[bytes.length - 2] = bytes[bytes.length - 2]! ^ 1;
			if (fault === 'held-resource-abort') { entered.resolve(); await release.promise; options?.signal?.throwIfAborted(); }
			return await consume(bytes);
		} finally { bytes.fill(0); active--; }
	} };
	const maskSource: MaskRasterSourcePortV1 = { async withBytes(reference, consume, options) {
		if (this !== maskSource || reference.storageKey !== brush.reference.storageKey) throw new TypeError('Combined brush authority or receiver changed.');
		options?.signal?.throwIfAborted(); active++; calls++;
		const bytes = brush.bytes.slice(); copies.push(bytes.buffer);
		try { if (fault === 'corrupt-brush') bytes[16] = bytes[16]! ^ 1; return await consume(bytes); }
		finally { bytes.fill(0); active--; }
	} };
	return { recipe, selection, options: Object.freeze({ source, maskSource }), entered, release,
		setFault(value: FullStackFaultCurrentV1) { if (active) throw new Error('Cannot change a live resource borrow.'); fault = value; calls = 0; copies.length = 0; },
		read: () => ({ active, calls, retired: copies.every(fullStackRetiredCurrentV1) }),
		close() { release.resolve(); lutBytes.fill(0); brush.bytes.fill(0); },
	};
}

/** These are independently authored counterexamples, not GPU stage receipts. */
export function fullStackAlternativesCurrentV1(recipe: Readonly<ImageDevelopStateV4>) {
	const effects = [...recipe.effects], tone = effects.findIndex(effect => effect.id === 'tone'), lut = effects.findIndex(effect => effect.id === 'lut');
	[effects[tone], effects[lut]] = [effects[lut]!, effects[tone]!];
	return {
		withoutRepair: normalizeImageDevelopStateV4({ ...recipe, repairs: { schemaVersion: 1, spots: [] } }),
		withoutMasks: normalizeImageDevelopStateV4({ ...recipe, maskBindings: [] }),
		reordered: normalizeImageDevelopStateV4({ ...recipe, effects }),
	};
}
