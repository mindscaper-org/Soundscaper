/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, posix } from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

import { chunkGroupForModulePath } from '../scripts/lib/build-chunk-groups.mjs';
import {
	dynamicRelativeImports,
	FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES,
	REACHABILITY_PLACED_TARGETS,
	staticRelativeDependencies,
} from './helpers/eager-chunk-group-crossings.ts';

const ARCHIVE_MODULES = [
	'editor-multicamera-source-rebind-sequence',
	'editor-project-visual-source-rebind',
	'editor-project-finishing-source-rebind',
	'editor-project-assistance-source-rebind',
	'editor-project-openfx-source-rebind',
	'editor-project-source-rebind',
	'editor-scape-asset-import-finishing',
	'editor-scape-assets-finishing',
	'editor-scape-assets',
	'editor-scape-native',
] as const;
const OWNER = 'framescaper-timeline-images';

function dependencies(path: string): readonly string[] {
	const code = transformSync(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
		loader: 'ts', format: 'esm',
	}).code;
	assert.deepEqual(dynamicRelativeImports(code), [], path);
	return staticRelativeDependencies(code).map(specifier => posix.normalize(posix.join(dirname(path), specifier)));
}

test('the complete Frame archive and identity rebind cluster has one exact image archive owner', () => {
	for (const leaf of ARCHIVE_MODULES) {
		const path = `src/framescaper/${leaf}.ts`;
		for (const separator of ['/', '\\']) {
			assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), OWNER, path);
			for (const foreign of [path + '.foreign', path.replace(/\.ts$/u, '-future.ts'), path.replace('/editor-', '/internal/editor-')]) {
				assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), OWNER, foreign);
			}
		}
		assert.equal(REACHABILITY_PLACED_TARGETS.has(path), false, path);
		assert.equal(FRAMESCAPER_BOOTSTRAP_COMPOSITION_LEAVES.includes(path), false, path);
		for (const target of dependencies(path)) {
			assert.notEqual(chunkGroupForModulePath(target), null, `${path} must retain an owned dependency: ${target}`);
			assert.doesNotMatch(target, /Bootstrap|runtime-selection|selected-finishing-authoring-controller/u);
		}
	}
	for (const leaf of [
		'editor-project-runtime-selection',
		'editor-selected-finishing-authoring-controller',
	]) assert.equal(chunkGroupForModulePath(`src/framescaper/${leaf}.ts`), null, leaf);
	const renderAuthority = 'src/framescaper/editor-native-render-plan-authority.ts';
	for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(renderAuthority.replaceAll('/', separator)), 'framescaper-project-foundations');
		assert.notEqual(chunkGroupForModulePath(renderAuthority.replaceAll('/', separator)), OWNER);
		for (const foreign of [renderAuthority + '.foreign', renderAuthority.replace('.ts', '-future.ts'),
			renderAuthority.replace('/editor-', '/internal/editor-')]) {
			assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), 'framescaper-project-foundations', foreign);
		}
	}
});

test('actual image archive extensions and their base archive dependencies cannot split into a chunk cycle', () => {
	for (const [from, to] of [
		['editor-project-timeline-image-source-rebind', 'editor-project-finishing-source-rebind'],
		['editor-scape-asset-import-timeline-image', 'editor-scape-asset-import-finishing'],
		['editor-scape-assets-timeline-image', 'editor-scape-assets-finishing'],
		['editor-scape-assets', 'editor-scape-assets-timeline-image-current'],
		['editor-scape-assets-timeline-image-current', 'editor-scape-assets-timeline-image'],
		['editor-scape-native', 'editor-scape-assets'],
	] as const) {
		const source = `src/framescaper/${from}.ts`;
		const target = `src/framescaper/${to}.ts`;
		assert.ok(dependencies(source).includes(target), `${source} must actually import ${target}`);
		assert.equal(chunkGroupForModulePath(source), OWNER, source);
		assert.equal(chunkGroupForModulePath(target), OWNER, target);
	}
});
