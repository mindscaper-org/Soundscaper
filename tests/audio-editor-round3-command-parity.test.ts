/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as range from '../src/common/editor/commands/range-runtime.js';
import * as clipboard from '../src/common/editor/commands/clipboard-runtime.js';
import * as link from '../src/common/editor/commands/clip-link-runtime.js';
import * as bin from '../src/common/editor/commands/project-source-bin-runtime.js';
import { round3CommandParity, type ParityCase } from './helpers/round3-command-parity.ts';

void test('500 editing scenarios retain frozen-base complete draft, result and refusal hashes', () => {
	const expected = JSON.parse(readFileSync(new URL('./fixtures/command-round3-parity.json', import.meta.url), 'utf8')) as { base: string; scenarios: ParityCase[] };
	const actual = round3CommandParity({ range, clipboard, link, bin });
	assert.deepEqual(actual, expected.scenarios);
});
