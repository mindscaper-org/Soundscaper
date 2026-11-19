/* SPDX-License-Identifier: AGPL-3.0-only */

import { LOCALIZED_M4A_ARTIST, localizedM4aMetadataFixture } from './localized-m4a-metadata-fixture.ts';
import { quickTimeTextM4aFixture } from './ordinary-tail-m4a-fixture.ts';

export interface Mp4TextMetadataCase {
	readonly id: string;
	readonly file: File;
	readonly normalized: Readonly<Record<string, unknown>>;
	readonly raw: Readonly<Record<string, unknown>>;
}

export async function mp4LocalizedCreditCases(): Promise<readonly Mp4TextMetadataCase[]> {
	const cases: Mp4TextMetadataCase[] = [];
	for (const style of ['mdta', 'ilst'] as const) for (const multiple of [false, true]) cases.push({
		id: `${style}-${String(multiple)}`, file: await localizedM4aMetadataFixture(multiple, style),
		normalized: { artist: 'Original performer', title: style === 'mdta' ? 'Localized credit control' : 'Two retained covers',
			...(style === 'ilst' ? { comment: 'After covers' } : {}) },
		raw: { [style === 'mdta' ? 'artist' : '©ART']: multiple ? LOCALIZED_M4A_ARTIST : 'Original performer',
			...(style === 'mdta' ? { engineer: 'Unrelated engineer' } : {}) },
	});
	return cases;
}

export async function quickTimeTextCases(): Promise<readonly Mp4TextMetadataCase[]> {
	const cases: Mp4TextMetadataCase[] = [];
	for (const encoding of ['macintosh', 'utf16', 'utf8', 'ffmpeg', 'ffmpeg-unlabelled'] as const) cases.push({
		id: encoding, file: await quickTimeTextM4aFixture(encoding), normalized: { title: 'Café', comment: 'After title' },
		raw: { '©nam': { '0.language': encoding === 'macintosh' ? '1' : encoding === 'ffmpeg-unlabelled' ? '0' : '5575',
			'0.text': 'Café', '1.language': '5575', '1.text': 'Second title' } },
	});
	return cases;
}
