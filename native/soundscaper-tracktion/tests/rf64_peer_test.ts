/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { unzipSync } from 'fflate';

import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { TracktionProjectService } from '../../../desktop/tracktion-project-service.ts';
import { waveData, wavFixture } from './wave_fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion RF64 tests through CTest.');

const cases = [
	{ name: 'finite lengths with larger ds64 values', frames: 1024, ds64: 4096, riffSentinel: false, dataSentinel: false, valid: true },
	{ name: 'truncated sentinel lengths', frames: 1024, ds64: 4096, riffSentinel: true, dataSentinel: true, valid: false },
	{ name: 'valid sentinel lengths', frames: 4096, ds64: 4096, riffSentinel: true, dataSentinel: true, valid: true },
	{ name: 'valid finite lengths', frames: 4096, ds64: 4096, riffSentinel: false, dataSentinel: false, valid: true },
];

for (const fixture of cases) test(`desktop Tracktion RF64 uses ${fixture.name}`, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-rf64-'));
	const project = join(root, 'project');
	const source = join(root, 'reference.wav');
	const media = join(project, 'media');
	const owner = {};
	const extracted = join(root, 'extracted');
	const service = new TracktionProjectService({
		scratchRoot: join(root, 'scratch'),
		isOwnerCurrent: (caller) => caller === owner,
		chooseCreateDirectory: async () => project,
		chooseOpenProject: async () => join(extracted, 'project.tracktionedit'),
		chooseWave: async () => source,
		chooseExport: async (format) => join(root, `export.${format}`),
		startPeer: async (options) => launchTracktionPeer({ ...options, executable }),
	});
	try {
		const wav = wavFixture(fixture.frames);
		const rf64 = rf64Fixture(wav, fixture);
		await mkdir(project);
		await writeFile(source, rf64);
		const opened = await service.request(owner, { kind: 'create', sampleRate: 48_000 });
		assert.ok(opened && 'sessionId' in opened);
		const { sessionId } = opened;
		const [track] = opened.project.tracks;
		assert.ok(track);
		const command = { kind: 'import', sessionId, revision: 0, trackId: track.id, start: 37 } as const;
		if (!fixture.valid) {
			await assert.rejects(service.request(owner, command), /Import requires|outside the Tracktion Edit/u);
			assert.deepEqual(await service.request(owner, { kind: 'project', sessionId, offset: 0 }), opened.project);
			assert.deepEqual(await readdir(media), []);
			assert.deepEqual(await readFile(source), rf64);
			return;
		}

		const imported = await service.request(owner, command);
		assert.ok(imported && 'itemId' in imported && imported.itemId);
		const clips = await service.request(owner, { kind: 'clips', sessionId, trackId: track.id, revision: imported.revision, offset: 0 });
		assert.ok(clips && 'clips' in clips);
		assert.deepEqual(clips.clips, [{ id: imported.itemId, name: 'reference', start: 37, end: 37 + fixture.frames, sourceOffset: 0 }]);
		const [stored] = await readdir(media);
		assert.ok(stored);
		assert.deepEqual(await readFile(join(media, stored)), rf64);
		assert.deepEqual(await readFile(source), rf64);
		await service.request(owner, { kind: 'archive', sessionId, revision: imported.revision });
		await service.request(owner, { kind: 'close', sessionId });
		const archive = unzipSync(await readFile(join(root, 'export.zip')));
		assert.deepEqual(archive[`media/${stored}`], Uint8Array.from(rf64));
		await mkdir(join(extracted, 'media'), { recursive: true });
		await Promise.all(Object.entries(archive).map(async ([entry, bytes]) => await writeFile(join(extracted, entry), bytes)));
		const reopened = await service.request(owner, { kind: 'open' });
		assert.ok(reopened && 'sessionId' in reopened);
		await service.request(owner, { kind: 'render', sessionId: reopened.sessionId, revision: reopened.project.revision });
		assert.deepEqual(waveData(await readFile(join(root, 'export.wav'))), Buffer.concat([Buffer.alloc(37 * 4), waveData(wav)]));
	} finally {
		try { await service.dispose(); }
		finally { await rm(root, { recursive: true, force: true }); }
	}
});

function rf64Fixture(wave: Buffer, { ds64, riffSentinel, dataSentinel }: (typeof cases)[number]): Buffer {
	const bytes = Buffer.alloc(36 + wave.length);
	bytes.write('RF64');
	bytes.writeUInt32LE(riffSentinel ? 0xffff_ffff : bytes.length - 8, 4);
	bytes.write('WAVEds64', 8);
	bytes.writeUInt32LE(28, 16);
	bytes.writeBigUInt64LE(BigInt(72 + ds64 * 4), 20);
	bytes.writeBigUInt64LE(BigInt(ds64 * 4), 28);
	bytes.writeBigUInt64LE(BigInt(ds64), 36);
	wave.copy(bytes, 48, 12);
	bytes.writeUInt32LE(dataSentinel ? 0xffff_ffff : wave.length - 44, 76);
	return bytes;
}
