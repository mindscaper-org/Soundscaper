/* SPDX-License-Identifier: AGPL-3.0-only */

import test from 'node:test';
import { legacyIndependentAudioCustody, type LegacyIndependentFolder } from './helpers/legacy-independent-audio-custody.ts';

for (const format of ['au', 'wav'] as const) for (const folder of [false, true, 'case-sibling', 'uppercase-marker'] satisfies LegacyIndependentFolder[]) {
	for (const standaloneFirst of [false, true]) test(`mixed legacy AUP retains independent ${format} audio; prior import=${standaloneFirst}, folder=${String(folder)}`, async context => {
		await legacyIndependentAudioCustody(context, { format, folder, standaloneFirst });
	});
}
