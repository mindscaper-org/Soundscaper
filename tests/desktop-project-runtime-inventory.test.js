/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DESKTOP_EXPECTED_RUNTIME_FILES } from '../scripts/lib/desktop-project-library-runtime.mjs';
import { DESKTOP_PROJECT_RUNTIME_FILES } from '../scripts/lib/desktop-project-runtime-files.mjs';
import { DESKTOP_SOUNDSCAPER_RUNTIME_FILES } from '../scripts/lib/desktop-soundscaper-runtime-files.mjs';
import { DESKTOP_ASSISTANCE_RUNTIME_FILES } from '../scripts/lib/desktop-assistance-runtime-files.mjs';

test('the shared desktop project inventory is sorted, unique and fully staged', () => {
	assert.deepEqual(DESKTOP_PROJECT_RUNTIME_FILES, [...DESKTOP_PROJECT_RUNTIME_FILES].sort());
	assert.equal(new Set(DESKTOP_PROJECT_RUNTIME_FILES).size, DESKTOP_PROJECT_RUNTIME_FILES.length);
	for (const member of DESKTOP_PROJECT_RUNTIME_FILES) {
		assert.equal(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), true, member);
	}
});

test('the native label clipboard descriptor is admitted to the desktop project runtime', () => {
	assert.ok(DESKTOP_PROJECT_RUNTIME_FILES.includes('src/common/editor/commands/label-clipboard-codec.js'));
});

test('CorridorKey inference application modules enter the exact compiled runtime inventory', () => {
	for (const member of [
		'desktop/assistance-corridorkey-hint.js',
		'desktop/assistance-corridorkey-model.js',
		'desktop/assistance-corridorkey-inference.js',
		'desktop/assistance-onnx-corridorkey-worker.js',
		'src/common/editor/assistance/corridorkey-hint-settings.js',
		'src/common/editor/assistance/corridorkey-pixels-v1.js',
		'src/common/editor/video-chroma-key.js',
	]) {
		assert.ok(DESKTOP_ASSISTANCE_RUNTIME_FILES.includes(member), member);
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), member);
	}
});

test('desktop project recovery declares its application closure independently of assistance runtime assets', () => {
	const shared = 'src/common/editor/storage/project-recovery-repository.js';
	const soundscaper = [
		'desktop/soundscaper-project-recovery-reader.js',
		'src/common/i18n/editor-project-recovery-copy.js',
		'src/common/i18n/editor-recording-recovery-copy.js',
		'src/soundscaper/desktop-project-recovery-bridge.js',
	];
	assert.ok(DESKTOP_PROJECT_RUNTIME_FILES.includes(shared), shared);
	for (const member of soundscaper) assert.ok(DESKTOP_SOUNDSCAPER_RUNTIME_FILES.includes(member), member);
	for (const member of [shared, ...soundscaper]) {
		assert.ok(DESKTOP_EXPECTED_RUNTIME_FILES.includes(member), member);
		assert.equal(DESKTOP_ASSISTANCE_RUNTIME_FILES.includes(member), false, member);
	}
});
