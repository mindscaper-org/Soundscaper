/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { createAup3Fixture, aup4NativeRichFixture, initSqlJs } from '../audio-editor-test-fixtures.js';
import { readAup4Document, writeAup4Document } from '../../../src/common/editor/aup4-database.js';
import { audacityXmlChildren, audacityXmlAttributes, decodeAudacityBinaryXml, encodeAudacityBinaryXml } from '../../../src/common/editor/audacity-binary-xml.js';

export function hash(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

/** Every revision changes actual project metadata; AUP3 also changes its PCM. */
export async function changedArchive(format, revision) {
	if (format === 'aup3') return Buffer.from(await createAup3Fixture({
		projectName: `Revision ${revision}`, tracks: [{ name: `Revision ${revision}`, clips: [{
			samples: Array.from({ length: 4800 + revision * 100 }, (_value, frame) => Math.sin(frame * revision * 0.05) * 0.25),
		}] }],
	}));
	const SQL = await initSqlJs();
	const database = new SQL.Database(aup4NativeRichFixture());
	try {
		const document = readAup4Document(database);
		const root = decodeAudacityBinaryXml(document.dictionary, document.document).root;
		const track = audacityXmlChildren(root, 'wavetrack')[0];
		audacityXmlAttributes(track, 'name')[0].value = `Revision ${revision}`;
		writeAup4Document(database, encodeAudacityBinaryXml(root), { autosave: false, now: revision });
		return Buffer.from(database.export());
	} finally { database.close(); }
}
