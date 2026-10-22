/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact measured candidate graphs; these identities grant neither download nor publication authority. */

import type { AssistanceOperationModelBinding } from './assistance-operation-contract.ts';
import type { AssistanceRuntimeFamilyModelGrantV1 } from './assistance-runtime-family-job-contract.ts';

export const CORRIDORKEY_MODEL_ID_V1 = 'corridorkey-2.0';
export const CORRIDORKEY_MODEL_VERSION_V1 = '2.0.0';

// Measured standalone FP32 graphs in evidence/framescaper-corridorkey-conversion-candidate.json.
export const CORRIDORKEY_GRAPH_ARTIFACTS_V1 = Object.freeze([
	Object.freeze({ role: 'cradio' as const, fileName: 'cradio.onnx', byteLength: 1727663765,
		sha256: 'f33324c398f74eff73a29e9c094fd24308444de731ad2edf636ffa96b9456a61' }),
	Object.freeze({ role: 'moge' as const, fileName: 'moge.onnx', byteLength: 352255692,
		sha256: '262a8786120b823f22228b0b8e02f31c40e9d54a1ad82f94fa68fdceadc9369c' }),
	Object.freeze({ role: 'rvm' as const, fileName: 'rvm.onnx', byteLength: 134996829,
		sha256: 'ddf1866d38ef9f03176e3d8c47c1ff45bd8c4d2be7a3559d88a635741659adbf' }),
	Object.freeze({ role: 'stage1' as const, fileName: 'stage1.onnx', byteLength: 1854944460,
		sha256: '0e511199835884c786f696c512c3182a7e8a5b441b15bc57c3d2c198d56f6ca9' }),
	Object.freeze({ role: 'stage2' as const, fileName: 'stage2.onnx', byteLength: 810350799,
		sha256: '83b1a62dfaff43ac298af93ea56bfbb78657f95533c786c67a179550a6ad88f0' }),
]);

export type CorridorKeyGraphRoleV1 = typeof CORRIDORKEY_GRAPH_ARTIFACTS_V1[number]['role'];
const DIGESTS = CORRIDORKEY_GRAPH_ARTIFACTS_V1.map(({ sha256 }) => sha256).sort();

export function assertCorridorKeyModelBindingV1(binding: AssistanceOperationModelBinding): void {
	if (binding.modelId !== CORRIDORKEY_MODEL_ID_V1 || binding.version !== CORRIDORKEY_MODEL_VERSION_V1
		|| JSON.stringify(binding.artifactSha256s) !== JSON.stringify(DIGESTS)) {
		throw new TypeError('Video keying requires the exact pinned CorridorKey 2.0 five-graph model identity.');
	}
}

export function assertCorridorKeyModelArtifactsV1(artifacts: readonly Readonly<{
	fileName: string; byteLength: number; sha256: string;
}>[]): void {
	if (artifacts.length !== CORRIDORKEY_GRAPH_ARTIFACTS_V1.length) {
		throw new TypeError('CorridorKey requires its exact five-graph inventory with no sidecar artifacts.');
	}
	for (const expected of CORRIDORKEY_GRAPH_ARTIFACTS_V1) {
		const matches = artifacts.filter(({ fileName }) => fileName === expected.fileName);
		if (matches.length !== 1 || matches[0]!.byteLength !== expected.byteLength
			|| matches[0]!.sha256 !== expected.sha256) {
			throw new TypeError('CorridorKey requires the exact pinned standalone graph bytes and filenames.');
		}
	}
}

export function corridorKeyModelPathsFromGrantsV1(
	models: readonly AssistanceRuntimeFamilyModelGrantV1[],
): Readonly<Record<CorridorKeyGraphRoleV1, string>> {
	if (models.length !== CORRIDORKEY_GRAPH_ARTIFACTS_V1.length
		|| models.some(model => model.modelId !== CORRIDORKEY_MODEL_ID_V1
			|| model.version !== CORRIDORKEY_MODEL_VERSION_V1)) {
		throw new TypeError('Video keying requires exactly the pinned CorridorKey model grants.');
	}
	const paths = {} as Record<CorridorKeyGraphRoleV1, string>;
	for (const expected of CORRIDORKEY_GRAPH_ARTIFACTS_V1) {
		const matches = models.filter(({ artifactRole }) => artifactRole === expected.role);
		const model = matches[0];
		if (matches.length !== 1 || !model || model.byteLength !== expected.byteLength
			|| model.sha256 !== expected.sha256 || typeof model.path !== 'string' || model.path === '') {
			throw new TypeError('Video keying requires exact pinned graph roles and artifact bytes.');
		}
		paths[expected.role] = model.path;
	}
	return Object.freeze(paths);
}
