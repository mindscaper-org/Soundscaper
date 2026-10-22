/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const ROOT = new URL('../', import.meta.url);

test('the stale-build prompt stays independent of the editor dialog chunk', async () => {
	const [dialog, css] = await Promise.all([
		readFile(new URL('src/common/site/StaleBuildDialog.jsx', ROOT), 'utf8'),
		readFile(new URL('src/common/site/site.css', ROOT), 'utf8'),
	]);
	assert.doesNotMatch(dialog, /@soundscaper\/design-system/u);
	assert.doesNotMatch(dialog, /AudioEditorDialogShell/u);
	assert.match(css, /\.website-stale-build-actions \{[^}]*justify-content: flex-end;/u);
});
