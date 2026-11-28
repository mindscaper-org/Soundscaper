/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createSoundscaperDesktopProjectLibraryHandshake } from
	'../desktop/soundscaper-project-library-contract.ts';
import { SoundscaperDesktopProjectLibraryMain } from
	'../desktop/soundscaper-project-library-main.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

test('the retained Soundscaper library rejects stale and changed-document fenced publications', async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-library-fence-'));
	const handshake = createSoundscaperDesktopProjectLibraryHandshake();
	let replaceAtCommit = false;
	let replacement: Promise<string> | null = null;
	let rival: ReturnType<SoundscaperDesktopProjectLibraryMain['openSession']> | null = null;
	const projectId = 'fenced-library-project';
	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 981, instanceId: 'fenced-library' },
		handshake,
		onLeaseLost: () => undefined,
		testControl: {
			leaseTtlMs: 30_000,
			renewIntervalMs: 5_000,
			checkpoint: (phase: 'prepared' | 'materialized' | 'committed' | 'complete') => {
				if (phase === 'materialized' && replaceAtCommit && rival) {
					replaceAtCommit = false;
					replacement = rival.claimProjectWriteFence(projectId);
				}
			},
		},
	});
	rival = main.openSession(handshake);
	const session = main.openSession(handshake);
	try {
		const base = createSoundscaperProject({ id: projectId, title: 'Base' });
		await session.beginPublication({
			publicationId: '31'.repeat(24), expectedMetadataRevision: 0,
			expectedProject: null, project: base, bodies: [],
		});
		await session.finishPublication({ publicationId: '31'.repeat(24) });
		const oldFence = await session.claimProjectWriteFence(projectId);
		const currentFence = await session.claimProjectWriteFence(projectId);
		const next = { ...base, revision: 1, title: 'Next', updatedAt: new Date().toISOString() };
		assert.notEqual(oldFence, currentFence);
		assert.equal(await session.checkProjectWriteFence({
			projectId, writeFence: oldFence, expectedDocument: base,
		}), false);
		assert.equal(await session.checkProjectWriteFence({
			projectId, writeFence: currentFence, expectedDocument: base,
		}), true);
		await assert.rejects(() => beginFenced(session, '32'.repeat(24), base, next, oldFence), /write-fence/u);
		await assert.rejects(() => beginFenced(session, '33'.repeat(24),
			{ ...base, title: 'Same revision, different data' }, next, currentFence), /write-fence/u);
		assert.equal((await session.readProjectBundle(projectId))?.document, JSON.stringify(base));
		replaceAtCommit = true;
		await assert.rejects(() => beginFenced(session, '34'.repeat(24), base, next, currentFence), /write-fence/u);
		assert.ok(replacement);
		const replacementFence = await replacement;
		assert.notEqual(replacementFence, currentFence);
		assert.equal((await session.readProjectBundle(projectId))?.document, JSON.stringify(base));
		await beginFenced(session, '35'.repeat(24), base, next, replacementFence);
		const committed = await session.finishPublication({ publicationId: '35'.repeat(24) });
		assert.equal(committed.document, JSON.stringify(next));
		const deleted = await session.deleteProject({
			projectId,
			expectedMetadataRevision: committed.metadataRevision,
			expectedProject: {
				projectRevision: committed.project.projectRevision,
				projectSha256: committed.project.sha256,
			},
		});
		assert.equal(deleted.deleted, true);
		assert.equal(await session.checkProjectWriteFence({
			projectId, writeFence: replacementFence, expectedDocument: next,
		}), false);
	} finally {
		await session.close();
		await rival.close();
		await main.close();
		await rm(root, { recursive: true, force: true });
	}
});

async function beginFenced(
	session: ReturnType<SoundscaperDesktopProjectLibraryMain['openSession']>,
	publicationId: string,
	expectedDocument: unknown,
	project: unknown,
	writeFence: string,
) {
	const current = await session.readProjectBundle(String((project as { id: unknown }).id));
	assert.ok(current);
	return session.beginPublication({
		publicationId,
		expectedMetadataRevision: current.metadataRevision,
		expectedProject: {
			projectRevision: current.project.projectRevision,
			projectSha256: current.project.sha256,
		},
		project,
		bodies: [],
		writeFence,
		expectedDocument,
	});
}
