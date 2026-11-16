/* SPDX-License-Identifier: AGPL-3.0-only */
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { authenticateYabridgePayload } from '../../desktop/yabridge-payload.ts';

export function yabridgeRequired(productId, target, nativeHarness = false) {
	return productId === 'soundscaper' && target === 'linux-x64' && !nativeHarness;
}

export async function stageYabridgePayload({ manifest, sourceRoot, runtimeRoot }) {
	const payload = await authenticateYabridgePayload(manifest, sourceRoot);
	const output = resolve(runtimeRoot, manifest.runtimePrefix);
	await mkdir(output, { recursive: true });
	for (const artifact of payload.artifacts) {
		await cp(artifact.path, join(output, artifact.path.split('/').at(-1)), { force: false, errorOnExist: true });
	}
	await authenticateYabridgePayload(manifest, runtimeRoot);
	return manifest;
}

export async function verifyStagedYabridge({ repositoryRoot, stageManifestPath, packagedTarget }) {
	const stage = JSON.parse(await readFile(stageManifestPath, 'utf8'));
	const required = yabridgeRequired(stage.productId, packagedTarget, stage.nativeHarnessPreparation === true);
	if (!required && !stage.yabridge) return null;
	if (!required || !stage.yabridge) throw new Error('The yabridge package target or build receipt is invalid.');
	const manifest = JSON.parse(await readFile(resolve(repositoryRoot, '.desktop-build/app/config/yabridge-native-payload.json'), 'utf8'));
	if (JSON.stringify(manifest) !== JSON.stringify(stage.yabridge)) throw new Error('The yabridge stage receipt differs.');
	return authenticateYabridgePayload(manifest, resolve(repositoryRoot, '.desktop-build/runtime'));
}
