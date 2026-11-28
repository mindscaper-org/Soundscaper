/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import test from 'node:test';

import {
	FRAMESCAPER_NATIVE_SERVICES_COPY,
	resolveFramescaperNativeServicesCopy,
} from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import {
	SOUNDSCAPER_MASTERING_SEQUENCE_COPY,
	resolveSoundscaperMasteringSequenceCopy,
} from '../src/common/editor/ui/soundscaper-mastering-sequence-copy.ts';

test('the retired flat copy catalog override helper is absent', async () => {
	await assert.rejects(access(new URL('../src/common/editor/ui/copy-catalog-overrides.ts', import.meta.url)), { code: 'ENOENT' });
});

test('Framescaper Native Services applies declared text overrides and preserves all other labels', () => {
	const defaults = FRAMESCAPER_NATIVE_SERVICES_COPY;
	assert.deepEqual(resolveFramescaperNativeServicesCopy(), defaults);
	assert.deepEqual(resolveFramescaperNativeServicesCopy({}), defaults);
	assert.deepEqual(resolveFramescaperNativeServicesCopy({
		'ui.framescaperNative.proxies': 'Stellvertreter',
		externalDisplay: '',
		externalDisplayNone: undefined,
		externalDisplayUnavailable: '  ',
		unknownKey: 'x',
	}), { ...defaults, proxies: 'Stellvertreter' });
	assert.equal(Object.isFrozen(resolveFramescaperNativeServicesCopy()), true);
});

test('mastering sequence copy applies declared text overrides and preserves all other labels', () => {
	const defaults = SOUNDSCAPER_MASTERING_SEQUENCE_COPY;
	assert.deepEqual(resolveSoundscaperMasteringSequenceCopy(), defaults);
	assert.deepEqual(resolveSoundscaperMasteringSequenceCopy({}), defaults);
	assert.deepEqual(resolveSoundscaperMasteringSequenceCopy({
		close: 'Schließen',
		masteringSequence: '',
		masteringSequences: '  ',
		masteringSequenceName: undefined,
		proxies: 'Stellvertreter',
	}), { ...defaults, close: 'Schließen' });
	assert.equal(Object.isFrozen(resolveSoundscaperMasteringSequenceCopy()), true);
});
