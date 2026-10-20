/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('product bootstraps observe runtime disposal failures on every detached path', async () => {
	const lifecycle = await readFile(new URL(
		'../src/common/editor/ui/audio-editor-web-bootstrap.tsx', import.meta.url,
	), 'utf8');
	assert.match(lifecycle,
		/void runtimePromise\.then\([\s\S]*?runtime\.dispose\(\)\.catch\(configuration\.reportRuntimeDisposalFailure\)/u,
		'the shared lifecycle must observe disposal when any in-flight runtime loses its owner',
	);
});
