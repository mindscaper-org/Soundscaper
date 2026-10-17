/* SPDX-License-Identifier: AGPL-3.0-only */

export interface LightscaperSmokeFileCurrentV1 {
	readonly name: string; readonly mimeType: string; readonly base64: string;
	readonly byteLength: number; readonly sha256: string;
}
export interface LightscaperSmokeRendererPlanCurrentV1 {
	readonly nonce: string; readonly stage: 1 | 2 | 3; readonly locale: 'en';
	readonly fixtures: readonly LightscaperSmokeFileCurrentV1[];
	readonly archive: LightscaperSmokeFileCurrentV1 | null;
	readonly expectedFingerprint: string | null; readonly expectedNamespace: string | null;
	readonly expectedPhotoIds: readonly string[] | null;
	readonly backupSuggestedName: string;
}
export interface LightscaperManagedSmokePlanCurrentV1 {
	readonly schemaVersion: 1; readonly nonce: string; readonly stage: 1 | 2 | 3;
	readonly profilePath: string; readonly renderer: Readonly<LightscaperSmokeRendererPlanCurrentV1>;
}
export interface LightscaperSmokeCustodyCurrentV1 {
	readonly namespace: string | null;
	readonly fingerprint: string;
	readonly root: unknown;
	readonly photos: readonly Readonly<{ document: unknown; sha256: string; byteLength: number; storage: string }>[];
}
export interface LightscaperSmokeRendererReportCurrentV1 {
	readonly nonce: string; readonly stage: 1 | 2 | 3;
	readonly initial: LightscaperSmokeCustodyCurrentV1 | null;
	readonly final: LightscaperSmokeCustodyCurrentV1;
	readonly preview: Readonly<{ width: number; height: number; pixels: readonly number[] }> | null;
	readonly rawRuntimeRequests: readonly string[];
	readonly publicBridgeKeys: readonly string[];
	readonly nodeExposed: boolean;
	readonly externalArchiveOpen: boolean;
}
export function lightscaperSmokeStableJsonCurrentV1(value: unknown): string {
	if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(item => lightscaperSmokeStableJsonCurrentV1(item)).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${lightscaperSmokeStableJsonCurrentV1(Object.getOwnPropertyDescriptor(value, key)?.value)}`).join(',')}}`;
	}
	throw new TypeError('Smoke fingerprint requires closed JSON values.');
}
