/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { auditDesktopPackageArtifactContent } from './lib/desktop-package-artifact-extractor.mjs';

/** Re-extract each AppX and apply the ordinary authenticated resource-closure audit. */
export default async function auditDesktopAppxArtifacts(context, dependencies = {}) {
	const repositoryRoot = resolve(context.configuration.directories?.app ?? '.desktop-build/app', '../..');
	const stagePath = resolve(repositoryRoot, '.desktop-build/stage-manifest.json');
	const runtimeManifestBytes = await readFile(stagePath);
	const stage = JSON.parse(runtimeManifestBytes.toString('utf8'));
	if (stage.target?.platform !== 'win' || !['x64', 'arm64'].includes(stage.target.arch)
		|| !['soundscaper', 'framescaper'].includes(stage.productId)) throw new Error('AppX requires a Windows desktop stage.');
	const artifacts = context.artifactPaths.filter(path => path.endsWith('.appx'));
	if (artifacts.length === 0) throw new Error('AppX packaging produced no AppX artifact.');
	const audit = dependencies.auditDesktopPackageArtifactContent ?? auditDesktopPackageArtifactContent;
	const receipts = [];
	for (const packagePath of artifacts) {
		const receipt = await audit({ packagePath: resolve(packagePath), repositoryRoot, runtimeManifestBytes,
			productId: stage.productId, targetId: `win-${stage.target.arch}` });
		const receiptPath = `${packagePath}.audit.json`;
		// Temporary extraction paths are not durable release evidence.
		const { resourcesPath: _resourcesPath, ...evidence } = receipt;
		await writeFile(receiptPath, `${JSON.stringify(evidence, null, 2)}\n`);
		receipts.push(receiptPath);
	}
	const adjacentManifest = resolve(context.outDir, `runtime-manifest-${stage.productId}-win-${stage.target.arch}.json`);
	await writeFile(adjacentManifest, runtimeManifestBytes);
	return [...receipts, adjacentManifest];
}
