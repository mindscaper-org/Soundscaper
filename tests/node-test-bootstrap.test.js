/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { collectTestDependencies, partitionNodeTestBootstrapBatches } from '../scripts/lib/node-test-bootstrap.mjs';

function fixture(context, sources) {
	const root = mkdtempSync(join(tmpdir(), 'soundscaper-test-bootstrap-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	for (const [file, source] of Object.entries({ 'package.json': '{"type":"module"}', ...sources })) {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), source);
	}
	return root;
}

test('closed JS cycles run natively while every transitive loader dependency retains hooks', context => {
	const root = fixture(context, {
		'tests/native.test.js': "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from './a.mjs'; test('native', () => assert.equal(value, 3));",
		'tests/a.mjs': "import './b.mjs'; export const value = 3;",
		'tests/b.mjs': "import './a.mjs';",
		'tests/typed.test.js': "import '../src/typed.ts';",
		'src/typed.ts': 'export const typed: number = 1;',
		'tests/component.test.js': "import './component.jsx';",
		'tests/component.jsx': "import './component.css'; export const view = <div />;",
		'tests/component.css': 'div {}',
		'tests/dynamic.test.mjs': 'const moduleName = "./component.jsx"; await import(moduleName);',
		'tests/package.test.js': "import 'external-package';",
		'tests/worker.test.js': "import { Worker } from 'node:worker_threads'; new Worker(new URL('./component.jsx', import.meta.url));",
	});
	const paths = ['native.test.js', 'typed.test.js', 'component.test.js', 'dynamic.test.mjs', 'package.test.js', 'worker.test.js']
		.map(name => join(root, 'tests', name));
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, paths), [
		{ files: [paths[0]], useLoaders: false }, { files: paths.slice(1), useLoaders: true },
	]);
	const native = spawnSync(process.execPath, ['--test', paths[0]], { cwd: root, encoding: 'utf8' });
	assert.equal(native.status, 0, native.stderr || native.stdout);
});

test('a later dependency edit reclassifies the whole JS cycle before the next invocation', context => {
	const root = fixture(context, {
		'tests/a.test.js': "import './helper.mjs';",
		'tests/helper.mjs': "import './a.test.js';",
		'tests/typed.ts': 'export const typed: number = 1;',
	});
	const file = join(root, 'tests/a.test.js');
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: false }]);
	writeFileSync(join(root, 'tests/helper.mjs'), "import './a.test.js'; import './typed.ts';");
	assert.deepEqual(partitionNodeTestBootstrapBatches(root, [file]), [{ files: [file], useLoaders: true }]);
});

test('prerequisite closures follow selected test helpers without traversing application imports', context => {
	const root = fixture(context, {
		'tests/reader.spec.js': "import './helpers/nested.ts'; import '../src/application.ts';",
		'tests/helpers/nested.ts': "export { reader } from './interchange-reference.ts';",
		'tests/helpers/interchange-reference.ts': 'export const reader = true;',
		'src/application.ts': "import '../tests/other.spec.js';",
		'tests/other.spec.js': 'export const other = true;',
	});
	assert.deepEqual([...collectTestDependencies(root, [join(root, 'tests/reader.spec.js')], { testHelpersOnly: true })].sort(),
		['tests/helpers/interchange-reference.ts', 'tests/helpers/nested.ts', 'tests/reader.spec.js'].map(file => join(root, file)));
});
