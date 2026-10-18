/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { array, field, integer, record, unique } from '../src/lightscaper/catalog/value-validation.ts';
import { normalizeVideoCubeLutReferenceV1 } from '../src/common/editor/cube-lut-reference-contract.ts';
import { normalizeBrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';
import { normalizePhotoDevelopPresetRowCurrentV1, type PhotoDevelopPresetRowCurrentV1 } from '../src/lightscaper/storage/photo-develop-preset-row-current-v1.ts';
import type { VideoCubeLutReferenceV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import type { BrushMaskResourceReferenceV1 } from '../src/common/editor/imaging/brush-mask-resource-v1.ts';

export type LightscaperNativePhotoMediaRestorePresetHeaderCurrentV1 = Readonly<{ rowSchemaVersion: 1 | 2 | 3 | 4; revision: number; presetCount: number }>;
export interface LightscaperNativePhotoMediaRestoreDeclarationsCurrentV1 {
	readonly presets: LightscaperNativePhotoMediaRestorePresetHeaderCurrentV1 | null;
	readonly luts: readonly Readonly<VideoCubeLutReferenceV1>[];
	readonly brushes: readonly Readonly<BrushMaskResourceReferenceV1>[];
}
export function captureLightscaperNativePhotoMediaRestoreDeclarationsCurrentV1(presetValue: unknown, lutValue: unknown, brushValue: unknown): LightscaperNativePhotoMediaRestoreDeclarationsCurrentV1 {
	let presets: LightscaperNativePhotoMediaRestorePresetHeaderCurrentV1 | null = null;
	if (presetValue !== null) {
		const input = record(presetValue, 'native restore preset header', ['rowSchemaVersion', 'revision', 'presetCount']), version = field(input, 'rowSchemaVersion');
		if (version !== 1 && version !== 2 && version !== 3 && version !== 4) throw new RangeError('Unsupported native restored preset row version.');
		presets = Object.freeze({ rowSchemaVersion: version, revision: integer(field(input, 'revision'), 1, Number.MAX_SAFE_INTEGER, 'preset revision'),
			presetCount: integer(field(input, 'presetCount'), 0, 16, 'preset count') });
	}
	const luts = array(lutValue, 'native restore LUT declarations', 0, 4094).map(raw => {
		const input = record(raw, 'native restore LUT declaration', ['id', 'entry', 'reference']), reference = normalizeVideoCubeLutReferenceV1(field(input, 'reference'));
		if (field(input, 'id') !== reference.storageKey || field(input, 'entry') !== `assets/luts/${reference.sha256}.cube`) throw new TypeError('Native restore LUT declaration differs.'); return reference;
	});
	const brushes = array(brushValue, 'native restore brush declarations', 0, 4094).map(raw => {
		const input = record(raw, 'native restore brush declaration', ['id', 'entry', 'reference']), source = record(field(input, 'reference'), 'native restore brush reference', ['storageKey', 'sha256', 'width', 'height', 'byteLength']);
		const reference = normalizeBrushMaskResourceReferenceV1(field(source, 'storageKey'));
		for (const key of ['storageKey', 'sha256', 'width', 'height', 'byteLength'] as const) if (field(source, key) !== reference[key]) throw new TypeError('Native restore brush reference differs.');
		if (field(input, 'id') !== reference.storageKey || field(input, 'entry') !== `assets/masks/${reference.sha256}.scmask`) throw new TypeError('Native restore brush declaration differs.'); return reference;
	});
	unique(luts.map(value => value.storageKey), 'native restore LUT identities'); unique(brushes.map(value => value.storageKey), 'native restore brush identities');
	return Object.freeze({ presets, luts: Object.freeze(luts.sort((a, b) => compare(a.storageKey, b.storageKey))),
		brushes: Object.freeze(brushes.sort((a, b) => compare(a.storageKey, b.storageKey))) });
}
export function captureLightscaperNativePhotoMediaRestorePresetCurrentV1(value: unknown, catalogId: string,
	header: LightscaperNativePhotoMediaRestorePresetHeaderCurrentV1 | null): PhotoDevelopPresetRowCurrentV1 {
	if (!header) throw new Error('Native restore declared Develop presets absent.');
	const row = normalizePhotoDevelopPresetRowCurrentV1(value, catalogId);
	if (row.schemaVersion !== header.rowSchemaVersion || row.revision !== header.revision || row.presets.length !== header.presetCount) throw new Error('Native restored Develop preset row differs from its header.');
	return row;
}
export function lightscaperNativePhotoMediaRestoreDigestCurrentV1(value: unknown): string {
	return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}
function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }
