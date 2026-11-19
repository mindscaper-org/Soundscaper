/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionAsset } from './motion-asset.ts';
import { motionArray, motionEnum, motionId, motionRecord, motionString } from './motion-values.ts';
export interface MotionNativeImportEntry {
	readonly scopeId: string; readonly propertyPath: string; readonly status: 'editable' | 'sampled' | 'unsupported'; readonly code: string; readonly message: string;
}
export interface MotionNativeImportCustody {
	readonly format: 'org.motionscaper.native-aep-import'; readonly version: 1; readonly sourceAssetId: string;
	readonly sourceFormat: 'aep' | 'aepx'; readonly report: readonly MotionNativeImportEntry[];
}
/** The source attachment participates in the normal hashed asset closure and every Save/export. */
export function normalizeMotionNativeImportCustody(value: unknown, assets: readonly MotionAsset[]): MotionNativeImportCustody {
	const record = motionRecord(value, ['format', 'version', 'sourceAssetId', 'sourceFormat', 'report'], 'native AEP custody');
	if (record.format !== 'org.motionscaper.native-aep-import' || record.version !== 1) throw new TypeError('Native AEP custody version is unsupported.');
	const sourceAssetId = motionId(record.sourceAssetId), sourceFormat = motionEnum(record.sourceFormat, ['aep', 'aepx'], 'native AEP format');
	const asset = assets.find(item => item.id === sourceAssetId);
	if (asset?.kind !== 'attachment' || asset.byteLength > 64 * 1024 * 1024 || asset.mimeType !== (sourceFormat === 'aep' ? 'application/vnd.adobe.aftereffects.project' : 'application/xml')) throw new TypeError('Native AEP source attachment is missing or changed.');
	const report = motionArray(record.report, 65_536, 'native AEP report').map(item => {
		const row = motionRecord(item, ['scopeId', 'propertyPath', 'status', 'code', 'message'], 'native AEP report row');
		return { scopeId: motionId(row.scopeId), propertyPath: motionString(row.propertyPath, 'native AEP property', 2048, true), code: motionId(row.code),
			status: motionEnum(row.status, ['editable', 'sampled', 'unsupported'], 'native AEP mapping'), message: motionString(row.message, 'native AEP report message', 4096) };
	});
	return { format: record.format, version: 1, sourceAssetId, sourceFormat, report };
}
