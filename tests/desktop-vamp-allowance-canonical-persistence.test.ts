/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { DesktopVampAnalyzerRegistry } from '../desktop/vamp-analyzer-registry.ts';
import { admitVampAnalyzerDescriptor } from '../desktop/vamp-analyzer-contract.ts';
registerHooks({ resolve(specifier, context, nextResolve) {
	const prefix = './project-library-runtime/desktop/';
	return nextResolve(specifier.startsWith(prefix) ? `./${specifier.slice(prefix.length).replace(/\.js$/u, '.ts')}` : specifier, context);
} });
const { createVampAnalyzerAllowanceStore } = await import('../desktop/vamp-analyzer-allowance-store.mjs');
const descriptors = Array.from({ length: 100 }, (_, index) => admitVampAnalyzerDescriptor({
	kind: 'analyzer', format: 'vamp', identifier: `org.example.analyzer${String(index)}`, name: `Analyzer ${String(index)}`,
	description: '', maker: 'Example', copyright: '', pluginVersion: 1, vampApiVersion: 2, inputDomain: 'time',
	minimumChannels: 1, maximumChannels: 2, preferredStepSize: 512, preferredBlockSize: 1024, parameters: [], programs: [],
	outputs: [{ identifier: 'events', name: 'Events', description: '', unit: '', binCount: 1, binNames: [], extents: null,
		quantizeStep: null, sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false }],
}));

test('Vamp allowance persistence stores each complete authenticated catalog once and restores decisions', async () => {
	let contents: string | null = null;
	const fileSystem = { statSync: () => ({ size: Buffer.byteLength(contents ?? '') }),
		readFileSync: () => { if (contents === null) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return contents; },
		writeFile: async (_path: string, value: string) => { contents = value; } };
	const errors: unknown[] = [];
	const store = createVampAnalyzerAllowanceStore({ filePath: '/allowances.json', fileSystem,
		authenticateLibrary: async () => ({ dev: 3, ino: 4 }), logError: (...args: unknown[]) => { errors.push(args); } });
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	let selected = '';
	for (let index = 0; index < 10; index += 1) {
		const observation = { kind: 'analyzer-library', format: 'vamp', libraryPath: `/vamp/v${String(index)}.so`, libraryBytes: 4096,
			librarySha256: index.toString(16).repeat(64), identity: { dev: 1, ino: index + 2 }, platform: 'linux', architecture: 'x64',
			compatibility: 'compatible', descriptors };
		const admission = registry.recordLibrary(observation); assert.equal(admission.status, 'recorded');
		if (admission.status !== 'recorded') return;
		store.observe(observation, admission);
		selected = admission.analyzers[0]!.installationId;
		registry.allow(selected); registry.select(selected);
	}
	await store.capture(registry);
	assert.ok(contents);
	const saved = JSON.parse(contents) as { schemaVersion: number; libraries: unknown[]; records: unknown[] };
	assert.equal(saved.schemaVersion, 2); assert.equal(saved.libraries.length, 10); assert.equal(saved.records.length, 1000);
	assert.ok(Buffer.byteLength(contents) < 1_000_000, 'catalogs are not repeated once per analyzer');
	const restored = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const reopened = createVampAnalyzerAllowanceStore({ filePath: '/allowances.json', fileSystem,
		authenticateLibrary: async () => ({ dev: 7, ino: 8 }), logError: (...args: unknown[]) => { errors.push(args); } });
	assert.equal(await reopened.rebind(restored, selected), true);
	assert.equal(restored.describe().entries.find(entry => entry.installations.some(installation => installation.installationId === selected))
		?.installations.find(installation => installation.installationId === selected)?.selected, true);
	assert.deepEqual(errors, []);
});

test('legacy allowance decisions migrate to canonical catalogs and catalog tampering is refused', async () => {
	const observation = { kind: 'analyzer-library', format: 'vamp', libraryPath: '/vamp/legacy.so', libraryBytes: 4096,
		librarySha256: 'a'.repeat(64), identity: { dev: 1, ino: 2 }, platform: 'linux', architecture: 'x64',
		compatibility: 'compatible', descriptors: [descriptors[0]] };
	const registry = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const admission = registry.recordLibrary(observation); assert.equal(admission.status, 'recorded');
	if (admission.status !== 'recorded') return;
	const { analyzerId, installationId } = admission.analyzers[0]!;
	let contents = JSON.stringify({ schemaVersion: 1, records: [{ digest: observation.librarySha256, analyzerId, installationId,
		allowed: true, selected: true, observation }] });
	const fileSystem = { statSync: () => ({ size: Buffer.byteLength(contents) }), readFileSync: () => contents,
		writeFile: async (_path: string, value: string) => { contents = value; } };
	const errors: unknown[] = [];
	const options = { filePath: '/legacy.json', fileSystem, authenticateLibrary: async () => ({ dev: 7, ino: 8 }),
		logError: (...args: unknown[]) => { errors.push(args); } };
	const restored = new DesktopVampAnalyzerRegistry({ isQuarantined: () => false });
	const store = createVampAnalyzerAllowanceStore(options);
	assert.equal(await store.rebind(restored, installationId), true);
	await store.capture(restored);
	const saved = JSON.parse(contents) as { schemaVersion: number; libraries: { observation: { libraryPath: string } }[] };
	assert.equal(saved.schemaVersion, 2);
	saved.libraries[0]!.observation.libraryPath = '/vamp/forged.so'; contents = JSON.stringify(saved);
	assert.equal(await createVampAnalyzerAllowanceStore(options).rebind(restored, installationId), false);
	assert.equal(errors.length, 1, 'a changed catalog cannot reuse an authenticated hash reference');
});
