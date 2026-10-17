/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { extractLightscaperArchiveOpenPathsCurrentV1 as extract } from '../desktop/lightscaper-archive-open-paths-current-v1.ts';

const working = resolve('/tmp/lightscaper-open');
test('Lightscaper argv routes all four terminal Scape suffixes, resolves cwd and deduplicates native paths', () => {
	assert.deepEqual(extract(['app', 'owned.liscape', './owned.liscape', 'frame.FSCAPE', 'old.scape', 'sound.sscape',
		pathToFileURL(resolve(working, 'owned.liscape')).href], working), ['owned.liscape', 'frame.FSCAPE', 'old.scape', 'sound.sscape'].map(value => resolve(working, value)));
});
test('Lightscaper argv ignores flag values, paired smoke flags, URLs and unrelated or disguised suffixes', () => {
	assert.deepEqual(extract(['app', '--user-data-dir', 'not-a-file.liscape', '--lightscaper-managed-smoke-plan=/tmp/plan.scape',
		'--lightscaper-managed-smoke-nonce', 'not-a-file.scape', '--unknown', 'not-a-file.fscape', '--no-sandbox', 'real.liscape',
		'https://example.test/remote.scape', 'bad.liscape.zip', 'ordinary.png', 'nul\0.scape', '--', '-literal.scape'], working),
		[resolve(working, 'real.liscape'), resolve(working, '-literal.scape')]);
});
test('Lightscaper argv rejects file URLs carrying credentials, query or fragment and bounds extraction', () => {
	assert.deepEqual(extract(['file:///tmp/owned.scape?x=1', 'file:///tmp/owned.scape#x', 'file://user@localhost/tmp/owned.scape'], working), []);
	assert.equal(extract(Array.from({ length: 100 }, (_, index) => `${index}.liscape`), working).length, 16);
});
