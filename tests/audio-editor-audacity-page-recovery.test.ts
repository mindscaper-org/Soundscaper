/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { recoverAudacityProjectWithPages } from '../src/common/editor/audacity-project-page-recovery.ts';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { streamAup4SourceAudio } from '../src/common/editor/aup4-import-audio.ts';
import { createAup3Fixture } from './aup3-fixture.js';
import { SQL } from './helpers/aup4-database-harness.js';
import { createAudacityDamagedOverflowFixture } from './helpers/audacity-damaged-overflow-fixture.ts';

test('normal Audacity recovery salvages broken overflow prefixes and streams exact silence for their tails', async () => {
	const damaged = await createAudacityDamagedOverflowFixture();
	const before = damaged.slice();
	const database = new SQL.Database(damaged);
	try {
		const recovered = await recoverAudacityProjectWithPages(database, new Blob([damaged]));
		const decoded = await decodeAudacityProjectTree(recovered.validation.document.root,
			() => assert.fail('planning must not read PCM'), { planAudio: true, recover: true });
		assert.equal(decoded.project.clips[0].timelineStartFrame, 96000);
		const samples: number[] = [];
		const plan = decoded.sources[0]!;
		assert.ok('channelPlans' in plan);
		for await (const channels of streamAup4SourceAudio(plan, recovered.readSamples)) samples.push(...channels[0]!);
		assert.equal(samples.length, 8192);
		const firstSilent = samples.indexOf(0);
		assert.ok(firstSilent > 0 && firstSilent < 8192);
		assert.deepEqual(samples.slice(0, firstSilent), Array.from({ length: firstSilent }, (_, index) => index % 2 ? -0.5 : 0.25));
		assert.ok(samples.slice(firstSilent).every(sample => sample === 0));
		const loss = recovered.validation.compatibilityReport.items.find(item => item.code === 'RECOVERED_AUDIO_SILENCE');
		assert.equal(loss?.data.silentFrames, 8192 - firstSilent);
		assert.ok(recovered.validation.compatibilityReport.items.some(item => item.code === 'RECOVERED_SQLITE_PAGE_AUDIO'));
		assert.deepEqual(damaged, before);
	} finally { database.close(); }
});

test('large recovery drops only native clip XML and boundary hints, reports that loss, and retains the editable timeline', async () => {
	const bytes = await createAup3Fixture({ tracks: [{ name: 'Long edit', clips: Array.from({ length: 771 }, (_, index) => ({
		offset: index * 2, samples: [0.25, -0.5], envelope: true,
	})) }] });
	const database = new SQL.Database(bytes);
	try {
		const recovered = await recoverAudacityProjectWithPages(database, new Blob([bytes]));
		await assert.rejects(decodeAudacityProjectTree(recovered.validation.document.root, () => assert.fail(), { planAudio: true }), /node limit/);
		const decoded = await decodeAudacityProjectTree(recovered.validation.document.root, () => assert.fail(), { planAudio: true, recover: true });
		assert.equal(decoded.project.tracks[0].name, 'Long edit');
		assert.equal(decoded.project.clips.length, 771);
		assert.equal(decoded.project.clips[770].timelineStartFrame, 1540 * 48000);
		assert.equal(decoded.project.clips[770].durationFrames, 2);
		assert.ok(decoded.project.clips[770].opaqueExtensions.aup4Envelope);
		assert.ok(decoded.compatibilityReport.items.some((item: { code: string }) => item.code === 'RECOVERY_NATIVE_CLIP_METADATA_OMITTED'));
	} finally { database.close(); }
});

test('page recovery propagates cancellation and source failures instead of certifying them as audio loss', async () => {
	const bytes = await createAudacityDamagedOverflowFixture();
	const database = new SQL.Database(bytes);
	try {
		await assert.rejects(recoverAudacityProjectWithPages(database, { size: bytes.length,
			slice() { throw new Error('source disconnected'); } }), /source disconnected/);
		let reads = 0;
		await assert.rejects(recoverAudacityProjectWithPages(database, { size: bytes.length,
			slice(start, end) { reads++; return new Blob([bytes.subarray(start, end)]); } }, {
			checkCancelled() { if (reads) throw new DOMException('cancelled', 'AbortError'); }, progress() {},
		}), { name: 'AbortError' });
	} finally { database.close(); }
});
