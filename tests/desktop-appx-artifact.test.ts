/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import auditDesktopAppxArtifacts from '../scripts/desktop-appx-after-artifact.mjs';

test('AppX artifacts retain exact stage evidence and fail if the installed closure fails auditing', async context => {
	const root = await mkdtemp(join(tmpdir(), 'scape-appx-artifact-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const outDir = join(root, 'release/appx');
	await mkdir(join(root, '.desktop-build/app'), { recursive: true });
	await mkdir(outDir, { recursive: true });
	const stage = Buffer.from(JSON.stringify({ productId: 'soundscaper', target: { platform: 'win', arch: 'arm64' } }));
	await writeFile(join(root, '.desktop-build/stage-manifest.json'), stage);
	const packagePath = join(outDir, 'Soundscaper-store-arm64.appx');
	const build = { artifactPaths: [packagePath], outDir,
		configuration: { directories: { app: join(root, '.desktop-build/app') } } };
	const artifacts = await auditDesktopAppxArtifacts(build, {
		auditDesktopPackageArtifactContent: async (input: { packagePath: string; repositoryRoot: string;
			runtimeManifestBytes: Buffer; productId: string; targetId: string }) => {
			assert.equal(input.packagePath, packagePath);
			assert.equal(input.repositoryRoot, root);
			assert.equal(input.productId, 'soundscaper');
			assert.equal(input.targetId, 'win-arm64');
			assert.deepEqual(input.runtimeManifestBytes, stage);
			return { status: 'installed-resource-closure-audited', resourcesPath: '/temporary/extraction', closureSha256: 'abc' };
		},
	});
	assert.deepEqual(artifacts, [`${packagePath}.audit.json`, join(outDir, 'runtime-manifest-soundscaper-win-arm64.json')]);
	assert.deepEqual(await readFile(artifacts[1]), stage);
	assert.deepEqual(JSON.parse(await readFile(artifacts[0], 'utf8')), {
		status: 'installed-resource-closure-audited', closureSha256: 'abc',
	});
	await assert.rejects(auditDesktopAppxArtifacts(build, {
		auditDesktopPackageArtifactContent: async () => { throw new Error('GPU payload changed'); },
	}), /GPU payload changed/u);
	await assert.rejects(auditDesktopAppxArtifacts({ ...build, artifactPaths: [] }), /no AppX artifact/u);
});
