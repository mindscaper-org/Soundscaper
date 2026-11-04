/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import {
	FFMPEG_RUNTIME_MANIFEST_PATH,
	canonicalJson,
	repinFfmpegRuntimeEvidence,
	verifyFfmpegRuntimeManifest,
} from '../scripts/lib/ffmpeg-runtime-manifest.mjs';
import { createFixture } from './helpers/ffmpeg-runtime-fixture.mjs';

const ROOT = resolve(import.meta.dirname, '..');

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function collectFilePins(value, pins = []) {
	if (Array.isArray(value)) {
		for (const entry of value) collectFilePins(entry, pins);
		return pins;
	}
	if (!value || typeof value !== 'object') return pins;
	const keys = Object.keys(value).filter((key) => key !== 'section').sort();
	if (keys.length === 3 && keys[0] === 'byteLength' && keys[1] === 'path' && keys[2] === 'sha256') {
		pins.push(value);
		return pins;
	}
	for (const entry of Object.values(value)) collectFilePins(entry, pins);
	return pins;
}

async function createStaleFixture(context) {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-repin-'));
	context.after(async () => { await rm(root, { recursive: true, force: true }); });
	const manifest = JSON.parse(await readFile(join(ROOT, FFMPEG_RUNTIME_MANIFEST_PATH), 'utf8'));
	const pins = collectFilePins(manifest);
	assert.equal(pins.length, 4, 'only FFmpeg source, notice, CORS and publication policy are pinned');
	for (const [index, pin] of pins.entries()) {
		const target = join(root, pin.path);
		await mkdir(dirname(target), { recursive: true });
		const heading = pin.section ? `## ${pin.section}\n\n` : '';
		await writeFile(target, `${heading}fixture body ${index} for ${pin.path}\n`);
		pin.byteLength = 1;
		pin.sha256 = '0'.repeat(64);
	}
	manifest.integrity.payloadSha256 = '1'.repeat(64);
	const manifestPath = join(root, FFMPEG_RUNTIME_MANIFEST_PATH);
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, '\t')}\n`);
	return { root, manifestPath, staleManifest: manifest };
}

test('repin reproduces the checked-in manifest byte for byte on a green tree', async () => {
	const checkedIn = await readFile(join(ROOT, FFMPEG_RUNTIME_MANIFEST_PATH), 'utf8');
	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot: ROOT });
	assert.equal(result.changed, false, 'the committed manifest pins are current');
	assert.equal(result.manifestText, checkedIn);
});

test('unrelated policies, notices and line-ending rules do not change FFmpeg evidence', async (context) => {
	const fixture = await createFixture(context);
	const before = await repinFfmpegRuntimeEvidence({ repositoryRoot: fixture.root });
	await writeFile(fixture.manifestPath, before.manifestText);
	for (const path of ['docs/policies/licensing.md', 'docs/policies/security.md']) {
		await writeFile(join(fixture.root, path), '# Unrelated policy update\n');
	}
	for (const path of ['config/production-licensing-matrix.json', 'config/production-security-matrix.json']) {
		const matrix = JSON.parse(await readFile(join(fixture.root, path), 'utf8'));
		matrix.unrelatedFeature = { description: 'Unrelated feature update' };
		await writeFile(join(fixture.root, path), JSON.stringify(matrix));
	}
	for (const [path, addition] of [
		['THIRD_PARTY_LICENSES.md', '\n## Unrelated dependency\nNew notice\n'],
		['.gitattributes', '/unrelated-file.txt text eol=lf\n'],
	]) {
		const bytes = await readFile(join(fixture.root, path));
		await writeFile(join(fixture.root, path), Buffer.concat([bytes, Buffer.from(addition)]));
	}
	const noticePath = join(fixture.root, 'THIRD_PARTY_LICENSES.md');
	await writeFile(noticePath, `## Earlier unrelated dependency\nEarlier notice\n\n${await readFile(noticePath, 'utf8')}`);
	const after = await repinFfmpegRuntimeEvidence({ repositoryRoot: fixture.root });
	assert.equal(after.manifestText, before.manifestText);
	assert.equal(after.changed, false);
	await verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root });
});

test('missing and duplicate FFmpeg notice sections fail verification and repinning', async (context) => {
	for (const duplicate of [false, true]) {
		const fixture = await createFixture(context);
		const noticePath = join(fixture.root, 'THIRD_PARTY_LICENSES.md');
		const notice = await readFile(noticePath, 'utf8');
		await writeFile(noticePath, duplicate ? `${notice}\n${notice}` : '## Unrelated dependency\n');
		await assert.rejects(
			verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root }),
			/runtime evidence notices must contain exactly one/iu,
		);
		await assert.rejects(
			repinFfmpegRuntimeEvidence({ repositoryRoot: fixture.root }),
			/runtime evidence notices must contain exactly one/iu,
		);
	}
});

test('FFmpeg policy entries are checked directly without general matrix pins', async (context) => {
	const fixture = await createFixture(context);
	const licensingPath = join(fixture.root, 'config/production-licensing-matrix.json');
	const licensing = JSON.parse(await readFile(licensingPath, 'utf8'));
	licensing.distributionChecks.find(({ id }) => id === 'ffmpeg-enabled-codec-patent-review').status = 'blocked';
	await writeFile(licensingPath, JSON.stringify(licensing));
	await assert.rejects(
		verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root }),
		/runtime publication distribution check must be blocked/iu,
	);
	const securityPath = join(fixture.root, 'config/production-security-matrix.json');
	const security = JSON.parse(await readFile(securityPath, 'utf8'));
	security.risks[0].currentControls = [];
	await writeFile(securityPath, JSON.stringify(security));
	await assert.rejects(
		verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root }),
		/production security matrix has no validated-ffmpeg-runtime-publication control/iu,
	);
});

test('changing the FFmpeg notice requires repinning and invalidates the old evidence', async (context) => {
	const fixture = await createFixture(context);
	const noticePath = join(fixture.root, 'THIRD_PARTY_LICENSES.md');
	const notice = await readFile(noticePath, 'utf8');
	await writeFile(noticePath, notice.replace('Fixture notices', 'Changed FFmpeg notices'));
	await assert.rejects(
		verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root }),
		/runtime evidence notices.*(?:byte length|digest)/iu,
	);
	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot: fixture.root });
	assert.equal(result.changed, true);
	await writeFile(fixture.manifestPath, result.manifestText);
	await verifyFfmpegRuntimeManifest({ repositoryRoot: fixture.root });
});

test('repin refreshes every stale file pin and the manifest integrity digest', async (context) => {
	const { root, manifestPath, staleManifest } = await createStaleFixture(context);

	const result = await repinFfmpegRuntimeEvidence({ repositoryRoot: root });
	assert.equal(result.changed, true);
	const repinned = JSON.parse(result.manifestText);
	const pins = collectFilePins(repinned);
	assert.equal(pins.length, collectFilePins(staleManifest).length);
	for (const pin of pins) {
		const bytes = await readFile(join(root, pin.path));
		assert.equal(pin.byteLength, bytes.byteLength, `${pin.path} byteLength`);
		assert.equal(pin.sha256, sha256(bytes), `${pin.path} sha256`);
	}

	const payload = Object.fromEntries(Object.entries(repinned).filter(([key]) => key !== 'integrity'));
	assert.equal(repinned.integrity.payloadSha256, sha256(Buffer.from(canonicalJson(payload))));
	assert.deepEqual(Object.keys(repinned.integrity), ['payloadSha256']);
	assert.equal(result.manifestText, `${JSON.stringify(repinned, null, '\t')}\n`, 'tab-serialized with a trailing newline');

	await writeFile(manifestPath, result.manifestText);
	const second = await repinFfmpegRuntimeEvidence({ repositoryRoot: root });
	assert.equal(second.changed, false, 'repin is idempotent');
	assert.equal(second.manifestText, result.manifestText);
});

test('repin rejects when a pinned evidence file is missing instead of pinning nothing', async (context) => {
	const { root } = await createStaleFixture(context);
	await rm(join(root, 'desktop/ffmpeg-corresponding-source.json'));
	await assert.rejects(
		repinFfmpegRuntimeEvidence({ repositoryRoot: root }),
		/desktop\/ffmpeg-corresponding-source\.json/u,
	);
});
