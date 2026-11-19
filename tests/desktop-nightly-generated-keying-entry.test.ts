/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { nightlyKeyingGeneratedEntry } from './helpers/nightly-keying-generated-entry.ts';

const SPEC = fileURLToPath(new URL('./browser/framescaper-corridorkey-native-source.spec.js', import.meta.url));
const DECODER = '../../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-native-decoder.ts';
const IMPORTS = 'import { build } from "esbuild"; import { fileURLToPath } from "node:url";';
const BUILD = `await build({entryPoints: [fileURLToPath(new URL('${DECODER}', import.meta.url))], bundle: true});`;

test('the actual generated ProRes browser bundle pays its physical native decoder entry', () => {
	assert.equal(nightlyKeyingGeneratedEntry(readFileSync(SPEC, 'utf8'), SPEC),
		fileURLToPath(new URL('../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-native-decoder.ts', import.meta.url)));
});

test('generated keying entry admission ignores comments and refuses dynamic, foreign or duplicate sources', () => {
	assert.equal(nightlyKeyingGeneratedEntry(`${IMPORTS}\n${BUILD}`, SPEC), nightlyKeyingGeneratedEntry(readFileSync(SPEC, 'utf8'), SPEC));
	for (const source of [
		`${IMPORTS}\n// ${BUILD}`,
		`${IMPORTS}\n${BUILD.replace(`'${DECODER}'`, 'sourcePath')}`,
		`${IMPORTS}\n${BUILD.replace(DECODER, '../../src/common/editor/foreign-decoder.ts')}`,
		`${IMPORTS}\n${BUILD}\n${BUILD}`,
		`${IMPORTS.replace('"esbuild"', '"foreign-builder"')}\n${BUILD}`,
		`${IMPORTS}\n${BUILD.replace('import.meta.url', 'sourceBase')}`,
	]) assert.throws(() => nightlyKeyingGeneratedEntry(source, SPEC), /generated keying|requires/iu);
});
