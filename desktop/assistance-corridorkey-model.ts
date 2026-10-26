/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact measured candidate graphs; these identities grant neither download nor publication authority. */

import type { AssistanceOperationModelBinding } from './assistance-operation-contract.ts';
import type { AssistanceRuntimeFamilyModelGrantV1 } from './assistance-runtime-family-job-contract.ts';

export const CORRIDORKEY_MODEL_ID_V1 = 'corridorkey-2.0';
export const CORRIDORKEY_MODEL_VERSION_V1 = '2.0.0';

// Measured standalone FP32 graphs in evidence/framescaper-corridorkey-conversion-candidate.json.
export const CORRIDORKEY_GRAPH_ARTIFACTS_V1 = Object.freeze([
	Object.freeze({ role: 'cradio' as const, fileName: 'cradio.onnx', byteLength: 1725128268,
		sha256: '5e9f2068f80e63ae81efaa16c00f77c7b26a2dac42f0efd06cea1a4b7ab3345f' }),
	Object.freeze({ role: 'moge' as const, fileName: 'moge.onnx', byteLength: 351133937,
		sha256: '4a0fdf370a20e8138929ae1e82dc3c7267681de9e75179408bc97809163d1baa' }),
	Object.freeze({ role: 'rvm' as const, fileName: 'rvm.onnx', byteLength: 133421377,
		sha256: 'a74756a230e84c891d4f40c1cd26705ee99399211120fa22deaf8d1d00846230' }),
	Object.freeze({ role: 'stage1' as const, fileName: 'stage1.onnx', byteLength: 1849637713,
		sha256: '9f54dcf8fe0634142a45011aba2d441a55426412aa346171cd2e8c19bf7b6b07' }),
	Object.freeze({ role: 'stage2' as const, fileName: 'stage2.onnx', byteLength: 807908972,
		sha256: '137517e2c5f00411c9e86252c19d6ffb1e44a874ed070cf29475cc257e0b32ff' }),
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
