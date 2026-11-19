/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createAup3Fixture } from '../aup3-fixture.js';

/** Damage a real SQLite overflow link without changing its readable payload prefix. */
export async function createAudacityDamagedOverflowFixture(): Promise<Uint8Array<ArrayBuffer>> {
	const directory = mkdtempSync(join(tmpdir(), 'scape-page-recovery-'));
	try {
		const source = join(directory, 'damaged.aup3');
		writeFileSync(source, await createAup3Fixture({ tracks: [{ name: 'Damaged music', clips: [{ offset: 2,
			samples: Array.from({ length: 8192 }, (_, index) => index % 2 ? -0.5 : 0.25),
		}] }] }));
		const native = new DatabaseSync(source);
		let overflow;
		try { overflow = native.prepare("SELECT pageno FROM dbstat WHERE name='sampleblocks' AND pagetype='overflow' ORDER BY pageno LIMIT 1").get(); }
		finally { native.close(); }
		assert.ok(overflow);
		const damaged = readFileSync(source), encodedSize = damaged.readUInt16BE(16);
		const pageSize = encodedSize === 1 ? 65536 : encodedSize;
		damaged.writeUInt32BE(0, (Number(overflow.pageno) - 1) * pageSize);
		return new Uint8Array(damaged);
	} finally { rmSync(directory, { recursive: true, force: true }); }
}
