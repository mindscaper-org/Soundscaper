/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { provisionTracktionSources } from './tracktion-sources.mjs';

export async function tracktionNotices(repositoryRoot) {
	const pins = 'config/soundscaper-tracktion-sources.json';
	const noticeFiles = [
		['Soundscaper-AGPL-3.0.txt', join(repositoryRoot, 'LICENSE')],
		['GPL-3.0.txt', join(repositoryRoot, 'LICENSES/GPL-3.0.txt')],
		['sources.json', join(repositoryRoot, pins)],
	];
	const sources = await provisionTracktionSources();
	for (const [name, root] of Object.entries(sources)) {
		noticeFiles.push([name + '/LICENSE.md', join(root, 'LICENSE.md')]);
		const modules = await moduleNotices(root, 'modules');
		for (const file of modules) noticeFiles.push([name + '/' + file, join(root, file)]);
	}
	noticeFiles.push(['tracktion/README.md', join(sources.tracktion, 'README.md')]);
	const result = new Map(await Promise.all(noticeFiles.map(async ([name, path]) => [name, await readFile(path)])));
	result.set('CORRESPONDING-SOURCE.txt', Buffer.from([
		'Soundscaper Tracktion Engine and JUCE source and build materials',
		'The exact upstream archives and their SHA-256 digests are in sources.json.',
		'Soundscaper source and build recipes: https://github.com/LeoWattenberg/Soundscaper',
		'Tracktion adapter, CMake changes and WASM patches: native/soundscaper-tracktion/',
		'Authenticated archive extraction: scripts/lib/tracktion-sources.mjs',
		'WASM build and toolchain pin: scripts/probe-tracktion-wasm.mjs',
		'',
	].join('\n')));
	return result;
}

export async function stageTracktionNotices(repositoryRoot, licenseRoot) {
	for (const [name, contents] of await tracktionNotices(repositoryRoot)) {
		const path = join(licenseRoot, 'tracktion', name);
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, contents);
	}
}

async function moduleNotices(root, path) {
	const entries = await readdir(join(root, path), { withFileTypes: true });
	return (await Promise.all(entries.map(async (entry) => {
		const file = path + '/' + entry.name;
		if (entry.isDirectory()) return moduleNotices(root, file);
		return entry.isFile() && /^(?:LICENSE|LICENCE|COPYING|NOTICE)(?:[._-].*)?$/u.test(entry.name) ? [file] : [];
	}))).flat().sort();
}
