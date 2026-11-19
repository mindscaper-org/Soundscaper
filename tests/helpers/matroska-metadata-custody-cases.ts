/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	attachmentCollisionWebmOpusFixture, customTaggedWebmOpusFixture, originalWorkTaggedWebmOpusFixture,
	reorderedTaggedWebmOpusFixture, repeatedTaggedWebmOpusFixture, translatedTaggedWebmOpusFixture,
} from './ordinary-ogg-opus-fixture.ts';

export interface MatroskaCustodyCase {
	readonly id: string;
	readonly file: File;
	readonly normalized: Readonly<Record<string, unknown>>;
	readonly raw: Readonly<Record<string, unknown>>;
	readonly emptyMetadata?: boolean;
	readonly attachment?: Readonly<{ name: string; byteLength: number }>;
}

export async function matroskaMetadataCustodyCases(): Promise<readonly MatroskaCustodyCase[]> {
	const result: MatroskaCustodyCase[] = [];
	for (const tagsFirst of [false, true]) for (const collision of [false, true]) result.push({
		id: `attachment-${String(collision)}-tags-first-${String(tagsFirst)}`,
		file: await attachmentCollisionWebmOpusFixture(collision, tagsFirst), normalized: { title: 'Collision programme' },
		raw: { [collision ? '123' : '_23']: 'Reviewed archive credit', 'attachment:123': 'Existing private escape-name control' },
		attachment: { name: 'licence.txt', byteLength: 27 },
	});
	const privateTags = Object.fromEntries([['constructor', 'Reviewed engineer'], ['toString', 'Reviewed producer'],
		['__proto__', 'Reviewed source owner'], ['_ordinary', 'Control']]);
	result.push({ id: 'private-own-keys', file: await customTaggedWebmOpusFixture(privateTags), normalized: {}, raw: privateTags });
	for (const repeated of [true, false]) result.push({ id: `repeated-${String(repeated)}`,
		file: await repeatedTaggedWebmOpusFixture(repeated),
		normalized: { artist: repeated ? 'Ada; Grace; Ada' : 'Ada', trackNumber: 2, tracksTotal: 12, comment: 'After credits' },
		raw: { ARTIST: repeated ? { 0: 'Ada', 1: 'Grace', 2: 'Ada' } : 'Ada' },
	});
	for (const nonDefault of [true, false]) for (const flagLast of [true, false]) result.push({
		id: `default-${String(nonDefault)}-flag-last-${String(flagLast)}`,
		file: await translatedTaggedWebmOpusFixture(nonDefault, flagLast),
		normalized: { artist: nonDefault ? 'Default performer' : 'Translated performer; Default performer', comment: 'After credits' },
		raw: { ARTIST: { 0: 'Translated performer', 1: 'Default performer' } },
	});
	for (const originalFirst of [false, true]) result.push({ id: `original-first-${String(originalFirst)}`,
		file: await originalWorkTaggedWebmOpusFixture(originalFirst), normalized: { artist: 'Current performer', title: 'Current title' },
		raw: { ARTIST: originalFirst ? { 0: 'Original performer', 1: 'Current performer' } : { 0: 'Current performer', 1: 'Original performer' } },
	});
	for (const mode of ['name-first', 'value-first', 'targets-last'] as const) result.push({ id: `order-${mode}`,
		file: await reorderedTaggedWebmOpusFixture(mode), normalized: mode === 'targets-last' ? {} : { artist: 'Ada' },
		raw: mode === 'targets-last' ? {} : { ARTIST: 'Ada' }, emptyMetadata: mode === 'targets-last',
	});
	return result;
}
