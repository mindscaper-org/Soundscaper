/* SPDX-License-Identifier: AGPL-3.0-only */

/** Claim validation and processing; the sibling watch-import test owns the client lifecycle. */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ATTACHED, BYTES, CLAIM_ID, CONTENT_SHA256, EMPTY, IMPORTED, LAST_MODIFIED, LOCATOR_ID, LOCATOR_REVISION,
	MIME, NAME, PROJECT_ID, PROXY_SHA256, SIZE, WITH_EXISTING, claim, messages, projectAt, rig, videoSource, watchedFile,
	type Data, type Rig,
} from './helpers/framescaper-native-watch-import-rig.ts';

test('a claim that is not an exact pathless record is refused before any acknowledgement', async () => {
	const withoutName = claim();
	delete withoutName.name;
	const symbolKeyed: Data = { ...withoutName, [Symbol('name') as unknown as string]: NAME };
	const shapes: readonly unknown[] = [
		'a claim string', 42, true, [], [claim()], {}, { ...claim(), extra: true },
		withoutName, symbolKeyed,
	];

	for (const shape of shapes) {
		const scope = rig({ claim: shape });

		assert.equal(await scope.watcher.pollNow(), false, `${String(shape)} must not import`);
		assert.ok(scope.rec.errors[0] instanceof TypeError);
		assert.equal(messages(scope.rec)[0], 'A selected watch-import claim must be an exact pathless record.');
		assert.deepEqual(scope.rec.completions, [], 'an unparsed claim owns no completion');
	}
});

test('every out-of-contract claim field is refused with an invalid-claim type error', async () => {
	const invalid: readonly Data[] = [
		{ schemaFamily: 'soundscaper' }, { schemaVersion: 2 }, { binId: 'other-bin' },
		{ generateProxies: 'yes' }, { existingSourceId: '' }, { existingSourceId: '-leading' },
		{ claimId: 'short' }, { locatorId: 'ZZZZZZZZZZZZZZZZ' }, { locatorRevision: '' },
		{ projectId: '.hidden' }, { projectRevision: -1 }, { projectRevision: 1.5 },
		{ importMode: 'move' }, { name: '' }, { name: 'nested/clip.mp4' },
		{ name: 'back\\slash.mp4' }, { name: 'x'.repeat(256) }, { size: 0 },
		{ size: 512 * 1024 ** 2 + 1 }, { size: 1.5 }, { mimeType: 'audio/mp4' },
		{ lastModified: -1 }, { contentSha256: 'f'.repeat(63) },
	];

	for (const overrides of invalid) {
		const label = Object.keys(overrides)[0]!;
		const scope = rig({ claim: claim(overrides) });

		assert.equal(await scope.watcher.pollNow(), false, `${label} must not import`);
		assert.deepEqual(messages(scope.rec), ['A selected watch-import claim is invalid.'], label);
		assert.ok(scope.rec.errors[0] instanceof TypeError, label);
		assert.deepEqual(scope.rec.completions, [], label);
	}
});

test('a project that is not an exact framescaper record is never offered to the claim bridge', async () => {
	const inexact: readonly unknown[] = [
		null, 'project', [], { ...EMPTY, schemaFamily: 'soundscaper' }, { ...EMPTY, schemaVersion: 2 },
		{ ...EMPTY, id: 'has space' }, { ...EMPTY, revision: -1 }, { ...EMPTY, revision: 2.5 },
		{ ...EMPTY, sources: 'none' }, { ...EMPTY, projectBin: null },
		{ ...EMPTY, projectBin: { clips: [], extra: 1 } }, { ...EMPTY, projectBin: { clips: 'none' } },
	];

	for (const project of inexact) {
		const scope = rig({ project: project as Data });

		assert.equal(await scope.watcher.pollNow(), false, `${String(project)} must not be claimed`);
		assert.deepEqual(scope.rec.claims, [], 'an inexact project owns no claim request');
	}
});

test('a claim request names the exact project revision it was read from', async () => {
	const scope = rig({ claim: null });

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(scope.rec.claims, [{
		schemaFamily: 'framescaper', schemaVersion: 1, projectId: PROJECT_ID, projectRevision: 2,
	}]);
});

test('a claim aimed at a stale project revision is negatively acknowledged', async () => {
	const scope = rig({ claim: claim({ projectRevision: 1 }) });

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['A watch-import claim targets a stale selected project.']);
	assert.deepEqual(scope.rec.completions, [{
		schemaFamily: 'framescaper', schemaVersion: 1, claimId: CLAIM_ID, projectId: PROJECT_ID,
		binId: 'project-bin', sourceId: null, contentSha256: CONTENT_SHA256,
		expectedProjectRevision: 1, committedProjectRevision: 1, success: false,
	}]);
	assert.deepEqual(scope.rec.imports, [], 'a stale claim never reaches the importer');

	const other = rig({ claim: claim({ projectId: 'project-2' }) });

	assert.equal(await other.watcher.pollNow(), false);
	assert.deepEqual(messages(other.rec), ['A watch-import claim targets a stale selected project.']);
	assert.equal(other.rec.completions[0]!.projectId, 'project-2');
});

test('an unavailable or stale watched locator fails the import before it starts', async () => {
	const loads: readonly (() => Promise<unknown>)[] = [
		async () => null,
		async () => ({ blob: watchedFile(), locatorRevision: 'e'.repeat(32) }),
	];

	for (const load of loads) {
		const scope = rig({ load });

		assert.equal(await scope.watcher.pollNow(), false);
		assert.deepEqual(messages(scope.rec), ['The watched linked-video locator is unavailable or stale.']);
		assert.deepEqual(scope.rec.imports, []);
		assert.equal(scope.rec.completions[0]!.success, false);
	}
});

test('a materialized blob whose metadata differs from the claim is refused', async () => {
	const blobs: readonly unknown[] = [
		{ size: SIZE, type: MIME, name: NAME, lastModified: LAST_MODIFIED },
		new File([`${BYTES}!`], NAME, { type: MIME, lastModified: LAST_MODIFIED }),
		new File([BYTES], NAME, { type: 'video/quicktime', lastModified: LAST_MODIFIED }),
		new File([BYTES], 'other.mp4', { type: MIME, lastModified: LAST_MODIFIED }),
		new File([BYTES], NAME, { type: MIME, lastModified: LAST_MODIFIED + 1 }),
		new Blob([BYTES], { type: MIME }), // A plain Blob carries neither name nor lastModified.
	];

	for (const blob of blobs) {
		const scope = rig({ load: async () => ({ blob, locatorRevision: LOCATOR_REVISION }) });

		assert.equal(await scope.watcher.pollNow(), false);
		assert.deepEqual(messages(scope.rec), ['The watched locator materialized different file metadata.']);
		assert.deepEqual(scope.rec.imports, []);
	}
});

test('a materialized file whose content digest no longer matches the claim is refused', async () => {
	const scope = rig({ claim: claim({ contentSha256: 'f'.repeat(64) }) });

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The watched video digest changed before import.']);
	assert.deepEqual(scope.rec.imports, []);
	assert.equal(scope.rec.completions[0]!.contentSha256, 'f'.repeat(64));
});

test('a link-mode import commits one revision, flushes it and acknowledges success', async () => {
	const scope: Rig = rig({ onImportFiles: (state) => { state.project = IMPORTED; } });

	assert.equal(await scope.watcher.pollNow(), true);
	assert.deepEqual(messages(scope.rec), []);
	assert.equal(scope.rec.imports.length, 1);
	assert.equal((scope.rec.imports[0]!.files[0] as File).name, NAME);
	assert.deepEqual(scope.rec.imports[0]!.options, {
		destination: 'project-bin',
		linkedVideoLocatorId: LOCATOR_ID,
		linkedVideoLocatorRevision: LOCATOR_REVISION,
	});
	assert.deepEqual(scope.rec.flushes, [{ forceCurrentSnapshot: true }]);
	assert.deepEqual(scope.rec.completions, [{
		schemaFamily: 'framescaper', schemaVersion: 1, claimId: CLAIM_ID, projectId: PROJECT_ID,
		binId: 'project-bin', sourceId: 'source-imported', contentSha256: CONTENT_SHA256,
		expectedProjectRevision: 2, committedProjectRevision: 3, success: true,
	}]);
});

test('a copy-mode import carries no linked-video locator into the importer', async () => {
	const scope = rig({
		claim: claim({ importMode: 'copy' }),
		onImportFiles: (state) => { state.project = IMPORTED; },
	});

	assert.equal(await scope.watcher.pollNow(), true);
	assert.deepEqual(scope.rec.imports[0]!.options, { destination: 'project-bin' });
});

test('an import that does not advance the project by exactly one revision is refused', async () => {
	const elsewhere = { ...IMPORTED, id: 'project-2' };

	for (const committed of [EMPTY, projectAt(4, [], []), elsewhere]) {
		const scope = rig({ onImportFiles: (state) => { state.project = committed; } });

		assert.equal(await scope.watcher.pollNow(), false);
		assert.deepEqual(messages(scope.rec),
			['The selected watch mutation did not commit one exact project revision.']);
	}
});

test('an import that creates no single new source matching the digest is refused', async () => {
	const twoMatches = projectAt(3,
		[videoSource('source-a'), videoSource('source-b')], ['source-a', 'source-b']);
	const wrongDigest = projectAt(3, [videoSource('source-a', null, 'e'.repeat(64))], ['source-a']);
	const preexisting = projectAt(3, [videoSource('source-existing')], ['source-existing']);

	for (const committed of [twoMatches, wrongDigest]) {
		const scope = rig({ onImportFiles: (state) => { state.project = committed; } });

		assert.equal(await scope.watcher.pollNow(), false);
		assert.deepEqual(messages(scope.rec), ['The watched digest did not create one exact video source.']);
	}

	const already = rig({
		project: WITH_EXISTING,
		onImportFiles: (state) => { state.project = preexisting; },
	});

	assert.equal(await already.watcher.pollNow(), false);
	assert.deepEqual(messages(already.rec),
		['The watched digest did not create one exact video source.'],
		'a source that already existed before the import cannot satisfy the claim');
});

test('an imported source missing its unique project-bin clip is left unacknowledged', async () => {
	const noClip = projectAt(3, [videoSource('source-imported')], []);
	const twoClips = projectAt(3, [videoSource('source-imported')], ['source-imported', 'source-imported']);
	const noAttachmentField = projectAt(3,
		[{ kind: 'video', id: 'source-imported', contentSha256: CONTENT_SHA256 }], ['source-imported']);

	for (const committed of [noClip, twoClips, noAttachmentField]) {
		const scope = rig({ onImportFiles: (state) => { state.project = committed; } });

		assert.equal(await scope.watcher.pollNow(), false);
		assert.deepEqual(messages(scope.rec),
			['The watched video is not uniquely committed in the selected project bin.']);
		assert.deepEqual(scope.rec.completions, [],
			'the project has already moved past the claim, so no completion is owed');
	}
});

test('an existing-source claim that names no committed source is negatively acknowledged', async () => {
	const scope = rig({ project: EMPTY, claim: claim({ existingSourceId: 'source-existing' }) });

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec),
		['The watched video is not uniquely committed in the selected project bin.']);
	assert.deepEqual(scope.rec.imports, [], 'an existing-source claim never imports');
	assert.equal(scope.rec.completions[0]!.success, false);
	assert.equal(scope.rec.completions[0]!.sourceId, null);
});

test('an existing-source claim with no proxy work reports empty work and returns the claim', async () => {
	const scope = rig({ project: WITH_EXISTING, claim: claim({ existingSourceId: 'source-existing' }) });

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['A watch claim carried no pending baseline work.']);
	assert.deepEqual(scope.rec.completions, [{
		schemaFamily: 'framescaper', schemaVersion: 1, claimId: CLAIM_ID, projectId: PROJECT_ID,
		binId: 'project-bin', sourceId: null, contentSha256: CONTENT_SHA256,
		expectedProjectRevision: 2, committedProjectRevision: 2, success: false,
	}]);
});

test('proxy generation on an existing source commits and acknowledges the attached revision', async () => {
	const attached = projectAt(3, [videoSource('source-existing', { ...ATTACHED })], ['source-existing']);
	const scope = rig({
		project: WITH_EXISTING,
		claim: claim({ existingSourceId: 'source-existing', generateProxies: true }),
		proxy: (state) => { state.project = attached; },
	});

	assert.equal(await scope.watcher.pollNow(), true);
	assert.deepEqual(messages(scope.rec), []);
	assert.deepEqual(scope.rec.generated, ['source-existing']);
	assert.deepEqual(scope.rec.flushes, [{ forceCurrentSnapshot: true }]);
	assert.equal(scope.rec.completions[0]!.committedProjectRevision, 3);
	assert.equal(scope.rec.completions[0]!.success, true);
});

test('a proxy claim offered against an already-attached source is refused as complete work', async () => {
	const scope = rig({
		project: projectAt(2, [videoSource('source-existing', { ...ATTACHED })], ['source-existing']),
		claim: claim({ existingSourceId: 'source-existing', generateProxies: true }),
		proxy: (state) => { state.project = projectAt(3, [], []); },
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The main process offered already-complete proxy work.']);
	assert.deepEqual(scope.rec.generated, [], 'complete work must not be regenerated');
	assert.equal(scope.rec.completions[0]!.success, false);
});

test('a proxy claim without a bound proxy scheduler is refused', async () => {
	const scope = rig({
		project: WITH_EXISTING,
		claim: claim({ existingSourceId: 'source-existing', generateProxies: true }),
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The selected authenticated proxy scheduler is unavailable.']);
	assert.equal(scope.rec.completions[0]!.success, false);
});

test('proxy generation that publishes no exact attachment returns the unfinished claim', async () => {
	const partial: readonly Data[] = [
		{ originalSha256: 'e'.repeat(64), sha256: PROXY_SHA256 },
		{ originalSha256: CONTENT_SHA256, sha256: 'not-a-digest' },
	];

	for (const attachment of [null, ...partial]) {
		const scope = rig({
			project: WITH_EXISTING, complete: () => false,
			claim: claim({ existingSourceId: 'source-existing', generateProxies: true }),
			proxy: (state) => {
				state.project = projectAt(3, [videoSource('source-existing', attachment)], ['source-existing']);
			},
		});

		assert.equal(await scope.watcher.pollNow(), false);
		assert.equal(messages(scope.rec)[0], 'Requested proxy generation did not publish an exact attachment.');
		assert.deepEqual(scope.rec.completions.map(item => [item.success, item.committedProjectRevision]), [[false, 2]]);
	}
});

test('a refused acknowledgement of a committed import is retried and then abandoned', async () => {
	const scope = rig({
		onImportFiles: (state) => { state.project = IMPORTED; }, complete: () => false,
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The watch-import completion was not acknowledged.'],
		'the silent retry loop reports nothing of its own when a completion is merely refused');
	assert.equal(scope.rec.completions.length, 4, 'one in-band acknowledgement plus three retries');
	assert.equal(scope.rec.flushes.length, 4);
});

test('a committed import whose acknowledgement is refused once succeeds on the first retry', async () => {
	const scope = rig({
		onImportFiles: (state) => { state.project = IMPORTED; }, complete: (attempt) => attempt > 1,
	});

	assert.equal(await scope.watcher.pollNow(), true);
	assert.equal(scope.rec.completions.length, 2);
	assert.deepEqual(messages(scope.rec), ['The watch-import completion was not acknowledged.']);
});

test('a flush that moves the project under a committed import retires the retry unacknowledged', async () => {
	const scope = rig({
		onImportFiles: (state) => { state.project = IMPORTED; },
		onFlush: (state) => { state.project = projectAt(9, [], []); },
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(messages(scope.rec), ['The active selected project changed during watch import.']);
	assert.equal(scope.rec.flushes.length, 1);
	assert.deepEqual(scope.rec.completions, [],
		'a commit that cannot be flushed onto the live project is never acknowledged');
});

test('an error reporter that throws never escapes the poll', async () => {
	const seen: string[] = [];
	const scope = rig({
		claim: claim({ projectRevision: 1 }),
		onError: (error) => {
			seen.push((error as Error).message);
			throw new Error('the reporter owns no authority');
		},
	});

	assert.equal(await scope.watcher.pollNow(), false);
	assert.deepEqual(seen, ['A watch-import claim targets a stale selected project.']);
	assert.equal(scope.rec.completions.length, 1, 'a throwing reporter must not skip the acknowledgement');
});

test('a bridge that rejects the claim request propagates out of the poll', async () => {
	const failure = new Error('the broker is offline');
	const scope = rig({ onClaim: () => { throw failure; } });

	await assert.rejects(scope.watcher.pollNow(), (error) => error === failure);
	assert.deepEqual(scope.rec.completions, [], 'an unanswered claim request owes no completion');
	assert.deepEqual(messages(scope.rec), [], 'a rejected claim request is the caller\'s to report');
});

test('the default scheduler polls on its own and disposal stops it re-arming', async () => {
	let firstPoll!: () => void;
	const polled = new Promise<void>((resolve) => { firstPoll = resolve; });
	let claims = 0;
	const scope = rig({
		claim: null,
		onClaim: () => { claims += 1; if (claims === 1) firstPoll(); },
		extra: { autoStart: true, intervalMs: 1 },
	});

	await polled;
	await scope.watcher.dispose();
	const settled = claims;
	await new Promise((resolve) => { setTimeout(resolve, 25); });

	assert.equal(claims, settled, 'the default timer must not re-arm after disposal');
	assert.ok(settled >= 1);
});
