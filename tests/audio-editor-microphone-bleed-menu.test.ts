/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffectMenuEntries } from '../src/common/editor/ui/effect-menu-organization.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSelectionEffectMenuGroups } from '../src/common/editor/ui/selection-effect-menu.ts';

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

test('selection menu composition requires two to eight explicitly selected microphones and a full-band time range', () => {
	for (const [count, spectral, expected] of [[1, false, false], [2, false, true], [8, false, true], [9, false, false], [2, true, false]] as const) {
		const tracks = Array.from({ length: count }, (_, index) => ({ id: `mic-${index}`, type: 'audio', clipIds: [] }));
		const { effectGroups } = createSelectionEffectMenuGroups({
			project: { tracks, clips: [], selection: { startFrame: 0, endFrame: 8000, trackIds: tracks.map(track => track.id), frequencyRange: spectral ? {} : null } },
			snapshot: {}, selectedClipId: null, copy: ENGLISH_COPY, productId: 'soundscaper', editBlocked: false,
			effectTargeting: { effectAudioTrack: tracks[0], explicitEffectSelectionActive: true, effectPreferenceTargetsAll: false },
			openSelectionEffect: () => undefined,
		});
		const entry = (effectGroups as readonly MenuEntry[]).find(group => group.id === 'noiseRepair')?.items?.find(item => item.id === 'automatic-microphone-bleed-reduction');
		assert.equal(entry?.disabled, !expected, `${count} microphones, spectral ${spectral}`);
	}
});
