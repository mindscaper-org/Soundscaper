/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { registerFileCapabilityIpc } from '../desktop/main-file-capability-ipc.mjs';

interface SaveDialogOptions { readonly defaultPath?: unknown }

async function fixture(t: test.TestContext, disabled = false, smokePath: string | null = null) {
	const home = await mkdtemp(join(tmpdir(), 'scape-projects-chooser-'));
	t.after(() => rm(home, { recursive: true, force: true }));
	const directory = join(home, 'My Projects');
	const handlers = new Map<string, (event: unknown, value: unknown) => unknown>();
	const dialogs: SaveDialogOptions[] = [];
	const choices: Array<{ canceled: boolean; filePath: string }> = [];
	let resolutions = 0;
	registerFileCapabilityIpc({
		channels: { chooseSaveTarget: 'save:choose' },
		desktopSmokeProbe: { resolveOpenPaths: () => null, resolveSavePath: async () => smokePath },
		dialog: {
			showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
			showSaveDialog: async (_window: unknown, options: SaveDialogOptions) => {
				dialogs.push(options);
				return choices.shift() ?? { canceled: true, filePath: '' };
			},
		},
		handle: (channel: string, handler: (event: unknown, value: unknown) => unknown) => {
			handlers.set(channel, handler);
		},
		opaqueId: (value: unknown) => String(value), ownerFor: () => 'owner',
		pendingOpenProjects: new Map(), readCapabilities: {}, saves: {},
		saveTargets: { registerPath: (path: string) => path }, windowFor: () => null,
		projectDirectory: async () => { resolutions += 1; return disabled ? null : directory; },
	});
	const choose = handlers.get('save:choose');
	assert.ok(choose);
	return {
		home, directory, dialogs, choices, resolutions: () => resolutions,
		choose: (purpose: string, suggestedName = 'A recording') => choose({}, { purpose, suggestedName }),
	};
}

test('project save menus start in the Projects directory and create it only when invoked', async (t) => {
	const f = await fixture(t);
	assert.equal(f.resolutions(), 0);
	await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
	for (const [purpose, extension] of [['project', 'sscape'], ['project-copy', 'sscape'], ['aup3', 'aup3'], ['aup4', 'aup4']]) {
		await f.choose(purpose);
		assert.equal(f.dialogs.at(-1)?.defaultPath, join(f.directory, `A recording.${extension}`));
	}
	assert.equal((await lstat(f.directory)).isDirectory(), true);
	assert.equal(f.resolutions(), 4);
});

test('ordinary exports keep the existing chooser default without resolving Projects', async (t) => {
	const f = await fixture(t);
	await f.choose('audio');
	assert.equal(f.dialogs[0].defaultPath, 'A recording.wav');
	assert.equal(f.resolutions(), 0);
	await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
});

test('a disabled Projects directory retains the normal project save default', async (t) => {
	const f = await fixture(t, true);
	await f.choose('project');
	assert.equal(f.dialogs[0].defaultPath, 'A recording.sscape');
	await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
});

test('an unavailable Projects directory still allows the save chooser to open', async (t) => {
	const f = await fixture(t);
	await writeFile(f.directory, 'a file blocks this directory');
	await f.choose('project');
	assert.equal(f.dialogs[0].defaultPath, 'A recording.sscape');
});

test('artifact smoke saves bypass production Projects resolution', async (t) => {
	const f = await fixture(t, false, '/isolated/test-project.sscape');
	assert.equal(await f.choose('project'), '/isolated/test-project.sscape');
	assert.equal(f.dialogs.length, 0);
	assert.equal(f.resolutions(), 0);
	await assert.rejects(lstat(f.directory), { code: 'ENOENT' });
});

test('a native project save confirms the suffixed destination before granting it', async (t) => {
	const f = await fixture(t);
	const typed = join(f.home, 'Evening recording');
	const supported = `${typed}.sscape`;
	await writeFile(supported, 'previous archive');
	f.choices.push({ canceled: false, filePath: typed });
	assert.equal(await f.choose('project'), null, 'canceling the corrected picker grants no destination');
	assert.equal(f.dialogs.at(-1)?.defaultPath, supported);
	assert.equal(await readFile(supported, 'utf8'), 'previous archive');
	await assert.rejects(lstat(typed), { code: 'ENOENT' });

	f.choices.push({ canceled: false, filePath: typed }, { canceled: false, filePath: supported });
	assert.equal(await f.choose('project'), supported);
});

test('a renamed cross-product copy keeps the suggested family suffix', async (t) => {
	const f = await fixture(t);
	const typed = join(f.home, 'Evening.mix');
	const supported = `${typed}.fscape`;
	f.choices.push({ canceled: false, filePath: typed }, { canceled: false, filePath: supported });
	assert.equal(await f.choose('project-copy', 'Interview.fscape'), supported);
	assert.equal(f.dialogs.at(-1)?.defaultPath, supported);
});
