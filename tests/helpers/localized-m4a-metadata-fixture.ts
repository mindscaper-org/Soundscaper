/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { appMetadataM4aFixture, multiValueM4aArtworkFixture } from './ordinary-tail-m4a-fixture.ts';

export const LOCALIZED_M4A_ARTIST = Object.freeze({
	'0.type': '1', '0.locale': '0', '0.text': 'Original performer',
	'1.type': '2', '1.locale': '4277', '1.text': 'Deutscher Künstler',
});

/** Apple QTFF data atoms carry an ordered value list with per-value type/locale. */
export async function localizedM4aMetadataFixture(multiple = true, style: 'mdta' | 'ilst' = 'mdta'): Promise<File> {
	const input = style === 'mdta'
		? await appMetadataM4aFixture({ artist: 'Original performer', title: 'Localized credit control', engineer: 'Unrelated engineer' })
		: (await multiValueM4aArtworkFixture(false, { artist: 'Original performer' })).file;
	const box = (type: string, body: Buffer): Buffer => {
		const header = Buffer.alloc(8); header.writeUInt32BE(body.length + 8); header.write(type, 4, 'latin1');
		return Buffer.concat([header, body]);
	};
	const atoms = (bytes: Buffer): Buffer[] => {
		const result: Buffer[] = [];
		for (let offset = 0; offset < bytes.length;) {
			const length = bytes.readUInt32BE(offset); assert.ok(length >= 8 && offset + length <= bytes.length);
			result.push(bytes.subarray(offset, offset + length)); offset += length;
		}
		return result;
	};
	let changed = 0;
	const rewrite = (bytes: Buffer): Buffer => Buffer.concat(atoms(bytes).map(child => {
		const type = child.toString('latin1', 4, 8);
		if (type === 'meta') {
			const prefix = child.readUInt32BE(8) === 0 ? child.subarray(8, 12) : Buffer.alloc(0);
			const fields = atoms(child.subarray(8 + prefix.length));
			const keys = fields.find(field => field.toString('latin1', 4, 8) === 'keys');
			const index = keys ? atoms(keys.subarray(16)).findIndex(key => key.toString('utf8', 8) === 'artist') + 1 : null;
			if (style === 'mdta') assert.ok(index !== null && index > 0);
			return box(type, Buffer.concat([prefix, ...fields.map(field => {
				if (field.toString('latin1', 4, 8) !== 'ilst') return field;
				return box('ilst', Buffer.concat(atoms(field.subarray(8)).map(item => {
					if (index === null ? item.toString('latin1', 4, 8) !== '©ART' : item.readUInt32BE(4) !== index) return item;
					changed++; if (!multiple) return item;
					const extra = Buffer.alloc(8); extra.writeUInt32BE(2); extra.writeUInt32BE(4277, 4);
					const text = Buffer.from('Deutscher Künstler', 'utf16le'); text.swap16();
					return box(item.toString('latin1', 4, 8), Buffer.concat([item.subarray(8), box('data', Buffer.concat([extra, text]))]));
				})));
			})]));
		}
		return ['moov', 'udta'].includes(type) ? box(type, rewrite(child.subarray(8))) : child;
	}));
	const result = rewrite(Buffer.from(await input.arrayBuffer())); assert.equal(changed, 1);
	return new File([Uint8Array.from(result)], `Localized-${style}-${String(multiple)}.m4a`, { type: input.type });
}
