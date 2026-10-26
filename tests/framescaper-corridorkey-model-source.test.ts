/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	verifyCorridorKeyModelSourceCandidate,
	verifyCorridorKeySourceFiles,
} from '../scripts/models/verify-corridorkey-model-source.ts';

const candidateUrl = new URL('../config/framescaper-corridorkey-model-source-candidate.json', import.meta.url);

async function candidate(): Promise<unknown> {
	return JSON.parse(await readFile(candidateUrl, 'utf8')) as unknown;
}

test('CorridorKey pins its checkpoint, statistics and all three foundation models', async () => {
	const reviewed = verifyCorridorKeyModelSourceCandidate(await candidate());
	assert.equal(reviewed.modelId, 'corridorkey-2.0');
	assert.deepEqual(reviewed.artifacts.map(({ localPath }) => localPath), [
		'weights/corridorkey_v2.safetensors', 'weights/foundation_stats.safetensors',
		'vfms/cradio/C-RADIOv4-SO400M/model.safetensors', 'vfms/moge/model.pt',
		'vfms/rvm/pretrain_rvm_small16_256_204031069.npz',
	]);
	assert.ok(reviewed.totalBytes > 5_000_000_000);
	assert.equal(reviewed.codeArtifacts.length, 30);
});

test('offline source verification reads every pinned byte and rejects corruption and parent symlinks', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-corridorkey-source-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const draft = await candidate() as Record<string, unknown>;
	const source = draft.source as Record<string, unknown>;
	const snapshot = source.cradioCodeSnapshot as Record<string, unknown>;
	const rows = [...source.artifacts as Record<string, unknown>[],
		...source.notices as Record<string, unknown>[], ...snapshot.files as Record<string, unknown>[]];
	// Small synthetic byte identities exercise the verifier without copying the 5 GB fixture.
	for (const row of rows) {
		const path = join(root, String(row.localPath));
		const body = Buffer.from(String(row.localPath));
		row.byteLength = body.byteLength;
		row.sha256 = createHash('sha256').update(body).digest('hex');
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, body);
	}
	await verifyCorridorKeySourceFiles(draft, root);
	const first = rows[0]!;
	const path = join(root, String(first.localPath));
	await writeFile(path, Buffer.alloc(Number(first.byteLength)));
	await assert.rejects(verifyCorridorKeySourceFiles(draft, root), /SHA-256 changed/u);
	await writeFile(path, Buffer.from(String(first.localPath)));
	const moved = join(root, 'external-cradio');
	const linked = join(root, 'vfms/cradio');
	await rm(linked, { recursive: true });
	await mkdir(moved);
	await symlink(moved, linked, 'dir');
	for (const row of rows.filter(({ localPath }) => String(localPath).startsWith('vfms/cradio/'))) {
		const target = join(linked, String(row.localPath).slice('vfms/cradio/'.length));
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, Buffer.from(String(row.localPath)));
	}
	await assert.rejects(verifyCorridorKeySourceFiles(draft, root), /must not traverse a symlink/u);
});

test('CorridorKey records CC-BY-NC-SA and preserves the separately pinned additional terms', async () => {
	const reviewed = verifyCorridorKeyModelSourceCandidate(await candidate());
	assert.equal(reviewed.codeLicense, 'CC-BY-NC-SA-4.0');
	assert.equal(reviewed.weightsLicense, 'CC-BY-NC-SA-4.0');
	assert.equal(reviewed.licensingStatus, 'pending-grant-reference');
	assert.equal(reviewed.publicationReady, false);
	assert.equal(reviewed.notices[0]?.sha256,
		'c92ce56f64162b231c7ce08ce3ed7d8cae15f01a560ca05a8e8db67878eb0065');
});

test('source review rejects omitted foundations, mutable revisions, and missing byte identities', async () => {
	const original = await candidate() as Record<string, unknown>;
	const source = original.source as Record<string, unknown>;
	const artifacts = source.artifacts as Record<string, unknown>[];
	const snapshot = source.cradioCodeSnapshot as Record<string, unknown>;
	for (const replacement of [
		{ ...source, artifacts: artifacts.slice(0, -1) },
		{ ...source, revision: 'master' },
		{ ...source, artifacts: [{ ...artifacts[0], sha256: '' }, ...artifacts.slice(1)] },
		{ ...source, artifacts: [{ ...artifacts[0], byteLength: 0 }, ...artifacts.slice(1)] },
		{ ...source, artifacts: [{ ...artifacts[0], localPath: '../weights.bin' }, ...artifacts.slice(1)] },
		{ ...source, artifacts: [{ ...artifacts[0], url: 'https://huggingface.co/model/resolve/main/model.bin' }, ...artifacts.slice(1)] },
		{ ...source, artifacts: [...artifacts.slice(0, -1), { ...artifacts.at(-1),
			url: 'https://huggingface.co/unrelated/replacement/resolve/485f5e9ab759ead6138cc990776184b59d6ea971/model.npz' }] },
		{ ...source, artifacts: [...artifacts.slice(0, 3), { ...artifacts[3],
			url: 'https://huggingface.co/unrelated/replacement/resolve/485f5e9ab759ead6138cc990776184b59d6ea971/model.pt' }, artifacts[4]] },
		{ ...source, cradioCodeSnapshot: { ...snapshot, files: (snapshot.files as unknown[]).slice(1) } },
	]) {
		assert.throws(() => verifyCorridorKeyModelSourceCandidate({ ...original, source: replacement }));
	}
});

test('pending conversion and grant evidence cannot be represented as an offered or published model', async () => {
	const original = await candidate() as Record<string, unknown>;
	assert.throws(() => verifyCorridorKeyModelSourceCandidate({ ...original, status: 'published' }));
	assert.throws(() => verifyCorridorKeyModelSourceCandidate({ ...original, publicationReady: true }));
	assert.throws(() => verifyCorridorKeyModelSourceCandidate({ ...original, licensing: {
		...original.licensing as Record<string, unknown>, status: 'permitted',
	} }));
	const catalog = JSON.parse(await readFile(new URL('../config/local-model-catalog.json', import.meta.url), 'utf8')) as {
		entries: readonly { modelId: string }[];
	};
	assert.equal(catalog.entries.some(({ modelId }) => modelId === 'corridorkey-2.0'), false);
});
