/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('take/comp control retains cross-product, clipboard, and round-trip evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'external-project-document-validation');
	const control = risk?.currentControls.find(
		({ id }) => id === 'take-comp-native-and-cross-product-preservation',
	);
	assert.notEqual(control, undefined);

	const evidencePaths = new Set(control.evidence.map(({ path }) => path));
	for (const path of [
		'src/common/editor/take-comp-domain.ts',
		'src/common/editor/commands/take-comp-runtime.ts',
		'src/common/editor/commands/take-comp-clipboard.ts',
		'src/common/editor/controller/track-audio/internal/take-comp/take-comp-flatten-service.ts',
		'src/common/editor/ui/dialogs/TakeCompDialog.tsx',
		'src/common/editor/scape-project.js',
		'src/soundscaper/product.js',
		'src/framescaper/product.js',
		'tests/audio-editor-take-comp-composition.test.ts',
		'tests/audio-editor-take-comp-clipboard.test.ts',
		'tests/browser/audio-editor-take-comp.spec.js',
		'tests/helpers/cycle-produced-take-fixture.ts',
		'tests/audio-editor-cycle-produced-take-fixture.test.ts',
		'tests/audio-editor-scape-take-comp-roundtrip.test.ts',
		'tests/desktop-soundscaper-project-library-baseline.test.ts',
	]) assert.equal(evidencePaths.has(path), true, path);
});
