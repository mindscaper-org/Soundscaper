/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { EAGER_CHUNK_GROUPS, resolveRelativeModule, sourceModules, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EDITOR = 'src/common/editor/';
const CURRENT = [
	'controller/composition/lightscaper-photo-backend-switch-current-v1.ts',
	'controller/composition/photo-library-linked-commands-current-v1.ts',
	'controller/composition/photo-library-linked-watch-current-v1.ts',
	'controller/shared/photo-library-raw-development-authoring-current-v1.ts',
	'controller/shared/photo-library-develop-command-current-v1.ts',
	'controller/shared/photo-library-develop-command-v3.ts',
	'controller/shared/photo-library-develop-workflow-current-v1.ts',
	'controller/shared/photo-library-workflow-slot-current-v1.ts',
	'controller/shared/photo-library-culling-workflow-v1.ts',
	'controller/shared/photo-library-develop-settings-intent-current-v1.ts',
	'controller/shared/photo-library-develop-settings-workflow-current-v1.ts',
	'controller/shared/internal/photo-library-develop-command-kernel-v1.ts',
	'controller/shared/internal/photo-library-develop-workflow-kernel-v1.ts',
	'controller/shared/internal/photo-library-workflow-slot-kernel-v1.ts',
	'controller/shared/internal/photo-library-develop-settings-workflow-kernel-v1.ts',
].map(path => EDITOR + path);
const SOURCE = sourceModules(resolve(ROOT, 'src')).filter(path => !path.endsWith('.d.ts'));
const CONTROLLER_OWNERS = new Set(['editor-controller-core', 'editor-photo-library-scalars']);
const COOWNERS = new Map<string, string[]>();
for (const path of SOURCE) {
	const owner = chunkGroupForModulePath(path);
	if (owner && CONTROLLER_OWNERS.has(owner)) { const files = COOWNERS.get(owner) ?? []; files.push(path); COOWNERS.set(owner, files); }
}
const RUNTIME = new Map<string, string>();
function runtime(path: string): string {
	let result = RUNTIME.get(path);
	if (result === undefined) {
		result = transformSync(readFileSync(path, 'utf8'), { sourcefile: path, format: 'esm',
			loader: path.endsWith('.tsx') ? 'tsx' : path.endsWith('.ts') ? 'ts' : path.endsWith('.jsx') ? 'jsx' : path.endsWith('.json') ? 'json' : 'js' }).code;
		RUNTIME.set(path, result);
	}
	return result;
}
function local(path: string): string { return relative(ROOT, path).split(sep).join('/'); }
interface Reached { readonly path: string; readonly via: string | null; readonly why: string }
/** Pay the Current controller/scalar boundary; other dependencies retain their actual static edges. */
function paidClosure(entry: string): ReadonlyMap<string, Reached> {
	const reached = new Map<string, Reached>(), pending: Reached[] = [{ path: resolve(ROOT, entry), via: null, why: 'actual shipped entry' }];
	const paid = new Set<string>();
	while (pending.length) {
		const next = pending.shift()!;
		if (reached.has(next.path)) continue;
		reached.set(next.path, next);
		// Refuse after retaining the real predecessor path; no unrelated graph
		// work is needed once the actual canonical catalog has been acquired.
		if (/\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u.test(local(next.path))) break;
		const owner = chunkGroupForModulePath(next.path);
		if (owner && !paid.has(owner)) {
			paid.add(owner);
			for (const path of COOWNERS.get(owner) ?? []) pending.push({ path, via: next.path, why: `paid co-owner [${owner}]` });
		}
		for (const specifier of staticRelativeDependencies(runtime(next.path))) {
			const path = resolveRelativeModule(next.path, specifier); assert.ok(path, `${local(next.path)} imports ${specifier}`);
			pending.push({ path, via: next.path, why: `static import ${specifier}` });
		}
	}
	return reached;
}

function witness(value: Reached, reached: ReadonlyMap<string, Reached>): readonly string[] {
	const result: string[] = [];
	let current: Reached | undefined = value;
	while (current) { result.unshift(`${local(current.path)} (${current.why})`); current = current.via ? reached.get(current.via) : undefined; }
	return result;
}

for (const entry of ['src/lightscaper/ui/LightscaperBootstrap.tsx', EDITOR + 'ui/lightscaper/LightscaperAppKernelV1.tsx']) {
	test(`actual Current entry and paid controller/scalar co-owners stay free of timeline/canonical passengers: ${entry}`, () => {
		const reached = paidClosure(entry);
		const bad = [...reached.values()].filter(({ path }) => {
			const owner = chunkGroupForModulePath(path);
			return ['editor-controller-core', 'editor-domain', 'editor-effect-contracts', 'editor-copy'].includes(owner ?? '')
				|| /\/i18n\/(?:canonical-extras[^/]*|catalogs|runtime|editor-copy-inventory)\./u.test(local(path));
		});
		const culprit = bad.find(value => /\/i18n\/canonical-extras/u.test(local(value.path))) ?? bad[0];
		assert.equal(bad.length, 0, JSON.stringify({ forbiddenCount: bad.length, witness: culprit ? witness(culprit, reached) : [] }));
		assert.ok(reached.has(resolve(ROOT, EDITOR + 'controller/shared/internal/photo-library-develop-workflow-kernel-v1.ts')));
		assert.ok(reached.has(resolve(ROOT, EDITOR + 'controller/shared/internal/photo-library-workflow-slot-kernel-v1.ts')));
	});
}

test('exact Current scalar/demand leaves keep finite ownership and leave generic controllers untouched', () => {
	for (const path of CURRENT) for (const separator of ['/', '\\']) {
		assert.equal(chunkGroupForModulePath(path.replaceAll('/', separator)), 'editor-photo-library-scalars', path);
		for (const foreign of [path + '.foreign', path.replace(/-v[13]\.ts$/u, '-v999.ts'), path.replace('/controller/', '/controller/foreign/')]) {
			assert.notEqual(chunkGroupForModulePath(foreign.replaceAll('/', separator)), 'editor-photo-library-scalars', foreign);
		}
	}
	const owner = chunkGroups.find(group => group.name === 'editor-photo-library-scalars'); assert.ok(owner);
	assert.equal(owner.priority, 99); assert.equal(owner.minSize, 0); assert.equal(owner.maxSize, 400_000);
	assert.equal(owner.includeDependenciesRecursively, false); assert.ok(EAGER_CHUNK_GROUPS.has('editor-photo-library-scalars'));
	for (const path of ['controller/shared/deferred-module-facade.ts', 'commands/video-keyframe-carrier.ts',
		'controller/shared/photo-library-future.ts', 'delivery-queue-runner.ts']) {
		assert.equal(chunkGroupForModulePath(EDITOR + path), 'editor-controller-core', path);
	}
	assert.equal(chunkGroupForModulePath(EDITOR + 'effects.js'), 'editor-domain');
	assert.equal(chunkGroupForModulePath('src/common/i18n/canonical-extras.js'), 'editor-copy');
});
