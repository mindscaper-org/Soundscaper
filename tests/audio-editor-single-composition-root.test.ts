/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));
const SOURCE_ROOT = join(REPOSITORY_ROOT, 'src');
const SOURCE_EXTENSIONS = /\.(?:jsx?|tsx?)$/u;

function sourceFiles(directory: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) found.push(...sourceFiles(path));
		else if (entry.isFile() && SOURCE_EXTENSIONS.test(entry.name)) found.push(path);
	}
	return found;
}

const SOURCES = sourceFiles(SOURCE_ROOT).map((path) => ({
	path: relative(REPOSITORY_ROOT, path).replaceAll('\\', '/'),
	text: readFileSync(path, 'utf8'),
}));

test('the shared editor app is a presentation seam with no self-constructing default export', () => {
	const app = SOURCES.find((source) => source.path === 'src/common/editor/ui/AudioEditorApp.jsx');
	assert.ok(app, 'AudioEditorApp.jsx must remain the shared frame');
	assert.match(app.text, /export function BoundAudioEditorApp\(/u);
	assert.doesNotMatch(app.text, /export default/u);
});

test('only the product editor controllers construct the shared controller', () => {
	const constructors = SOURCES
		.filter((source) => /\bcreateAudioEditorController\s*\(\s*null\b/u.test(source.text))
		.map((source) => source.path)
		.sort();
	assert.deepEqual(constructors, [
		'src/framescaper/editor-controller.ts',
		// The explicitly selected successor line owns its v2 environment and session.
		'src/framescaper/editor-successor-controller.ts',
		'src/soundscaper/editor-controller.ts',
	]);
});
