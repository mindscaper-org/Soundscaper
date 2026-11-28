/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdirSync, mkdtempSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { openTracktionWindow } from './tracktion-window.ts';

export function tracktionSmokeProfile(args: readonly string[]): string | null {
	if (!args.includes('--soundscaper-smoke')) return null;
	const option = '--soundscaper-smoke-app-data=';
	const directory = args.find((argument) => argument.startsWith(option))?.slice(option.length);
	if (!directory || !isAbsolute(directory)) throw new Error('Tracktion smoke requires an absolute scratch path.');
	mkdirSync(directory, { recursive: true, mode: 0o700 });
	return mkdtempSync(join(directory, 'tracktion-'));
}

export async function probeTracktionDesktop(
	editor: Awaited<ReturnType<typeof openTracktionWindow>>,
	projectDirectory: string,
): Promise<void> {
	await mkdir(projectDirectory, { mode: 0o700 });
	const project = await editor.requestProject({ kind: 'create', sampleRate: 48_000 });
	if (!project || !('sessionId' in project) || project.project.sampleRate !== 48_000) {
		throw new Error('The Tracktion smoke project did not open at 48 kHz.');
	}
	const { sessionId } = project;
	const name = 'Package smoke track';
	const edit = await editor.requestProject({ kind: 'addTrack', sessionId, revision: project.project.revision, name });
	if (!edit || !('itemId' in edit) || !edit.itemId) throw new Error('Tracktion did not create the smoke track.');
	await editor.requestProject({ kind: 'save', sessionId, revision: edit.revision });
	const file = await readFile(join(projectDirectory, 'project.tracktionedit'), 'utf8');
	if (!/<EDIT\b/u.test(file) || !file.includes(`name="${name}"`)) {
		throw new Error('Tracktion did not save the smoke track in its native Edit.');
	}
	const { webContents } = editor.window;
	console.log('SOUNDSCAPER_TRACKTION_DESKTOP_SMOKE ' + JSON.stringify({
		url: webContents.getURL(), title: webContents.getTitle(), savedNativeEdit: true,
		platform: process.platform, arch: process.arch,
	}));
}
