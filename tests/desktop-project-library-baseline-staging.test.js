/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	DESKTOP_EXPECTED_RUNTIME_FILES,
} from '../scripts/lib/desktop-project-library-runtime.mjs';
import {
	DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES,
} from '../scripts/lib/desktop-project-library-baseline-runtime-files.mjs';

const RETIRED_LIBRARY = /(?:^|\/)(?:soundscaper-)?project-library-v(?:10|1[2-9]|20)(?:-|\.)/u;

test('desktop staging contains only unversioned v1 project-library authorities', () => {
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.some((file) => RETIRED_LIBRARY.test(file)), false);
	for (const retired of ['contract', 'main-channels']) {
		assert.equal(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(
			`desktop/project-library-exact-generation-${retired}.js`,
		), false);
	}
	assert.deepEqual(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.filter((file) => (
		file.startsWith('desktop/framescaper-project-library-')
	)), [
		'desktop/framescaper-project-library-contract.js',
		'desktop/framescaper-project-library-current-project.js',
		'desktop/framescaper-project-library-database.js',
		'desktop/framescaper-project-library-main-channels.js',
		'desktop/framescaper-project-library-main-ipc.js',
		'desktop/framescaper-project-library-main.js',
		'desktop/framescaper-project-library-values.js',
		'desktop/framescaper-project-library-writer.js',
	]);
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/soundscaper-project-library-main.js'));
	assert.deepEqual(DESKTOP_EXPECTED_RUNTIME_FILES.filter((file) => (
		/^desktop\/soundscaper-project-library-(?:ipc|main-(?:ipc|channels|preload))\.js$/u.test(file)
	)), []);
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/project-library-immediate-transaction.js'));
	assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes('desktop/project-library-path-layout.js'));
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/local-model-file-io.js'));
	assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(
		'src/framescaper/editor-project-feature-manifest-context.js',
	));
	assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(
		'src/common/editor/video-drawable-interval.js',
	));
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes(
		'src/framescaper/desktop-project-library-publication-identity.js',
	), false);
});

test('desktop staging omits the retired Soundscaper desktop delivery modules', () => {
	assert.deepEqual(DESKTOP_EXPECTED_RUNTIME_FILES.filter((file) => file.startsWith('desktop/soundscaper-delivery-')), []);
});

test('desktop staging keeps the active native media executor', () => {
	assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/native-media-v14-executor.js'));
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/native-media-execution.js'), false);
});

test('desktop staging omits the unused in-process M5B diagnostic runner', () => {
	assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes('desktop/framescaper-m5b-diagnostic-runner.js'), false);
});

test('desktop staging includes the shared Framescaper durable asset authority', () => {
	assert.ok(DESKTOP_PROJECT_LIBRARY_BASELINE_RUNTIME_FILES.includes(
		'src/framescaper/editor-scape-durable-asset-plan-core.js',
	));
});
