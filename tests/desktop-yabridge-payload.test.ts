/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { authenticateYabridgePayload, YABRIDGE_RUNTIME_FILES, YABRIDGE_RUNTIME_PREFIX } from '../desktop/yabridge-payload.ts';
import { yabridgeRequired, stageYabridgePayload } from '../scripts/lib/yabridge-staging.mjs';
import { auditExtractedDesktopPackageContent, writeDesktopPackageContentManifest } from '../scripts/lib/desktop-package-content-manifest.mjs';
import { packageTree } from './helpers/desktop-package-content-fixture.js';

test('yabridge is bundled only for ordinary Soundscaper Linux x64 packages', () => {
	assert.equal(yabridgeRequired('soundscaper', 'linux-x64', false), true);
	for (const target of ['linux-arm64', 'mac-arm64', 'win-x64', 'win-arm64']) {
		assert.equal(yabridgeRequired('soundscaper', target, false), false);
	}
	assert.equal(yabridgeRequired('framescaper', 'linux-x64', false), false);
	assert.equal(yabridgeRequired('soundscaper', 'linux-x64', true), false);
});

test('installed-package audits bind bundled yabridge bytes and require their corresponding source', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const fixture = await packageTree(t);
	const directory = join(fixture.resourcesRoot, 'runtime', YABRIDGE_RUNTIME_PREFIX);
	await mkdir(directory, { recursive: true });
	const files = [];
	for (const path of YABRIDGE_RUNTIME_FILES) {
		const bytes = Buffer.from(`packaged ${path}`);
		await writeFile(join(directory, path), bytes);
		files.push({ path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	}
	const yabridge = { schemaVersion: 1, target: 'linux-x64', runtimePrefix: YABRIDGE_RUNTIME_PREFIX, status: 'built', files };
	Object.assign(fixture.runtimeManifest, { yabridge });
	await writeFile(fixture.runtimeManifestPath, `${JSON.stringify(fixture.runtimeManifest, null, 2)}\n`);
	const options = { resourcesRoot: fixture.resourcesRoot, runtimeManifestPath: fixture.runtimeManifestPath,
		productId: 'soundscaper', targetId: 'linux-x64' };
	assert.equal((await writeDesktopPackageContentManifest(options)).fileCount, 12);
	const audit = { extractedRoot: fixture.extractedRoot, runtimeManifestBytes: await readFile(fixture.runtimeManifestPath),
		productId: 'soundscaper', targetId: 'linux-x64' };
	assert.equal((await auditExtractedDesktopPackageContent(audit)).fileCount, 12);
	await writeFile(join(directory, 'libyabridge-vst3.so'), 'changed');
	await assert.rejects(auditExtractedDesktopPackageContent(audit), /digest|closure|length/iu);
	const missing = await packageTree(t);
	Object.assign(missing.runtimeManifest, { yabridge: { ...yabridge, files: files.filter(({ path }) => path !== 'corresponding-source.tar.gz') } });
	await writeFile(missing.runtimeManifestPath, `${JSON.stringify(missing.runtimeManifest, null, 2)}\n`);
	await assert.rejects(writeDesktopPackageContentManifest({ ...options, resourcesRoot: missing.resourcesRoot,
		runtimeManifestPath: missing.runtimeManifestPath }), /yabridge content authority/iu);
});

test('runtime admission and packaging reject changed, missing, extra or symbolic bridge files', { skip: process.platform !== 'linux' || process.arch !== 'x64' }, async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'yabridge-payload-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const directory = join(root, 'input', YABRIDGE_RUNTIME_PREFIX);
	await mkdir(directory, { recursive: true });
	const files = [];
	for (const path of YABRIDGE_RUNTIME_FILES) {
		const bytes = Buffer.alloc(128); bytes.write(`fixture ${path}`, 64);
		bytes.write('\x7fELF', 0, 'binary'); bytes[4] = 2; bytes[5] = 1; bytes.writeUInt16LE(62, 18);
		await writeFile(join(directory, path), bytes);
		files.push({ path, byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
	}
	const manifest = { schemaVersion: 1, target: 'linux-x64', runtimePrefix: YABRIDGE_RUNTIME_PREFIX,
		source: { version: '5.1.1+test', commit: 'a'.repeat(40) }, status: 'built', files };
	assert.equal((await authenticateYabridgePayload(manifest, join(root, 'input'))).artifacts.length, 7);
	await stageYabridgePayload({ manifest, sourceRoot: join(root, 'input'), runtimeRoot: join(root, 'output') });
	assert.equal((await authenticateYabridgePayload(manifest, join(root, 'output'))).version, manifest.source.version);
	await writeFile(join(directory, files[0]!.path), 'changed');
	await assert.rejects(authenticateYabridgePayload(manifest, join(root, 'input')), /changed/u);
	await assert.rejects(authenticateYabridgePayload({ ...manifest, status: 'ci-generated' }, join(root, 'output')), /unavailable/u);
	await writeFile(join(root, 'output', YABRIDGE_RUNTIME_PREFIX, 'unexpected.so'), 'bad');
	await assert.rejects(authenticateYabridgePayload(manifest, join(root, 'output')), /inventory/u);
	await rm(join(root, 'output', YABRIDGE_RUNTIME_PREFIX, 'unexpected.so'));
	await assert.rejects(authenticateYabridgePayload({ ...manifest, files: files.filter((file) => file.path !== 'COPYING') }, join(root, 'output')));
	const first = join(root, 'output', YABRIDGE_RUNTIME_PREFIX, files[0]!.path);
	await rm(first); await symlink(join(directory, files[1]!.path), first);
	await assert.rejects(authenticateYabridgePayload(manifest, join(root, 'output')));
});
