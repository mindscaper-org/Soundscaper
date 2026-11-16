/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMenuEntries } from '../src/common/editor/ui/effect-menu-organization.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';

interface MenuEntry { readonly id: string; readonly disabled?: boolean; readonly items?: readonly MenuEntry[] }

test('bleed reduction is reachable in categorized and alphabetical menus, only with an explicit multitrack target', () => {
	for (const organization of ['default', 'sortby:name']) {
		for (const available of [false, true]) {
			const entries = createEffectMenuEntries({ organization, copy: ENGLISH_COPY,
				effectLabels: new Map([['automatic-microphone-bleed-reduction', ENGLISH_COPY.microphoneBleedTitle]]),
				productId: 'soundscaper', disabled: false, selectionActive: true, microphoneBleedAvailable: available,
			}, () => undefined) as readonly MenuEntry[];
			const item = organization === 'default' ? entries[0]?.items?.[0] : entries[0];
			assert.equal(item?.id, 'automatic-microphone-bleed-reduction');
			assert.equal(item?.disabled, !available);
		}
	}
	assert.deepEqual(createEffectMenuEntries({ organization: 'default', copy: ENGLISH_COPY,
		effectLabels: new Map([['automatic-microphone-bleed-reduction', ENGLISH_COPY.microphoneBleedTitle]]),
		productId: 'framescaper', disabled: false, selectionActive: true, microphoneBleedAvailable: true,
	}, () => undefined), []);
});
