/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { transformSync } from 'esbuild';
import { chunkGroupForModulePath, chunkGroups } from '../scripts/lib/build-chunk-groups.mjs';
import { resolveRelativeModule, staticRelativeDependencies } from './helpers/eager-chunk-group-crossings.ts';

const modulePath = (name: string) => fileURLToPath(new URL(name, new URL('../src/common/editor/', import.meta.url)));
const LEAVES = [
	['unicode-scalar-text.ts', 'editor-neutral-foundations', []],
	['../foundation/closed-domain-value.ts', 'editor-neutral-foundations', []],
	['ui/modal-native-range-keys.ts', 'editor-dialog-foundations', []],
	['controller/shared/photo-library-cull-advance-v1.ts', 'editor-photo-library-scalars',
		['../../../foundation/closed-domain-value.ts', './photo-library-selection-v1.ts']],
	['storage/opfs-blob-write-plan.ts', 'editor-media-custody-storage',
		['../../foundation/abort-error.ts', './opfs-sync-worker-protocol.ts']],
] as const;
const FORBIDDEN_OWNERS = new Set(['editor-domain', 'editor-shell', 'editor-controller-core', 'editor-storage-model']);

for (const [name, owner, expectedDependencies] of LEAVES) {
	test(`Current Lightscaper neutral leaf has exact ownership and imports: ${name}`, () => {
		const module = modulePath(name);
		for (const path of [module, module.replaceAll('/', '\\')]) {
			assert.equal(chunkGroupForModulePath(path), owner, path);
			assert.notEqual(chunkGroupForModulePath(path + '.foreign'), owner);
			assert.notEqual(chunkGroupForModulePath(path.replace(/\.ts$/u, '-future.ts')), owner);
		}
		const group = chunkGroups.find(candidate => candidate.name === owner); assert.ok(group);
		assert.equal(group.priority, 99); assert.equal(group.minSize, 0); assert.equal(group.maxSize, 400_000);
		assert.equal(group.includeDependenciesRecursively, false);
		assert.deepEqual(dependencies(module), expectedDependencies);
		const visited = new Set<string>(), pending = [module];
		while (pending.length) {
			const path = pending.pop()!; if (visited.has(path)) continue; visited.add(path);
			assert.ok(!FORBIDDEN_OWNERS.has(chunkGroupForModulePath(path) ?? ''), path);
			for (const specifier of dependencies(path)) {
				const target = resolveRelativeModule(path, specifier); assert.ok(target, specifier); pending.push(target);
			}
		}
		const expected = name === 'controller/shared/photo-library-cull-advance-v1.ts'
			? [name, '../foundation/closed-domain-value.ts', 'controller/shared/photo-library-selection-v1.ts']
			: name === 'storage/opfs-blob-write-plan.ts'
				? [name, '../foundation/abort-error.ts', 'storage/opfs-sync-worker-protocol.ts'] : [name];
		assert.deepEqual([...visited].sort(), expected.map(modulePath).sort());
	});
}

function dependencies(path: string): readonly string[] {
	return staticRelativeDependencies(transformSync(readFileSync(path, 'utf8'), { loader: 'ts', format: 'esm' }).code);
}
