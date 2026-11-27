/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { TracktionRejectedCommand } from '../../../desktop/tracktion-peer-contract.ts';
import { launchTracktionPeer } from '../../../desktop/tracktion-peer.ts';
import { writeFileSizeLimitedPeer } from './file-size-limited-peer-fixture.ts';

const executable = process.env.SOUNDSCAPER_TRACKTION_TEST_PEER;
if (!executable) throw new Error('Run the Tracktion persistence tests through CTest.');

test('a short Tracktion Save preserves the existing file and the unsaved Edit', { skip: process.platform !== 'linux' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-tracktion-short-save-'));
	const limited = join(root, 'limited-peer');
	const exchangeDirectory = join(root, 'exchange');
	const projectDirectory = join(root, 'project');
	const edit = join(projectDirectory, 'project.tracktionedit');
	const launch = { projectDirectory, exchangeDirectory, stateDirectory: join(root, 'state') };
	const project = { kind: 'project', offset: 0 } as const;
	try {
		await mkdir(exchangeDirectory);
		await writeFileSizeLimitedPeer(limited, 2);
		const peer = launchTracktionPeer({ ...launch, executable: limited, mode: 'create', sampleRate: 48_000 });
		try {
			await peer.request({ kind: 'save', revision: 0 });
			const saved = await readFile(edit);
			assert.ok(saved.length < 2048);
			let revision = 0;
			for (let index = 0; index < 5; index += 1) {
				({ revision } = await peer.request({ kind: 'addTrack', revision, name: `Added ${index + 1}` }));
			}
			const before = await peer.request(project);
			let refusal: unknown;
			await peer.request({ kind: 'save', revision }).catch((error: unknown) => { refusal = error; });
			const afterSave = await readFile(edit);
			assert.equal(afterSave.length, saved.length, 'The short write must leave the complete prior Edit on disk.');
			assert.deepEqual(afterSave, saved);
			assert.ok(refusal instanceof TracktionRejectedCommand);
			assert.match(refusal.message, /Cannot save the Tracktion Edit/u);
			assert.deepEqual(await peer.request(project), before);
			for (let index = 0; index < 4; index += 1) {
				({ revision } = await peer.request({ kind: 'undo', revision }));
			}
			await peer.request({ kind: 'save', revision });
			assert.equal((await peer.request(project)).canRedo, true);
		} finally { await peer.close(); }
		const reopened = launchTracktionPeer({ ...launch, executable, mode: 'open' });
		try {
			assert.deepEqual((await reopened.request(project)).tracks.map(({ name }) => name), ['Track 1', 'Added 1']);
		} finally { await reopened.close(); }
	} finally { await rm(root, { recursive: true, force: true }); }
});
