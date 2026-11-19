/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup4DatabaseAdapter } from './aup4-database-sql.js';
import { inspectAudacityRecovery } from './audacity-recovery-inspection.ts';

/** Mutate only a private worker copy, retaining its native dictionary and unrelated rows. */
export function repairAudacityNativeCopy(database: unknown): Readonly<{ repairedReferences: number }> {
	const inspection = inspectAudacityRecovery(database);
	if (!inspection.canRepair) throw new Error('Native copy repair requires an intact active document and database with only missing audio blocks. Use editing-copy recovery for other damage.');
	const table = inspection.activeDocument;
	if (table !== 'project' && table !== 'autosave') throw new Error('No active Audacity document.');
	const sql = createAup4DatabaseAdapter(database);
	const [dictionary, original] = sql.rows(`SELECT dict, doc FROM ${table} WHERE id=1`)[0] as [Uint8Array, Uint8Array];
	const document = original.slice(), view = new DataView(document.buffer, document.byteOffset, document.byteLength);
	for (const block of inspection.missing) {
		const width = block.type === 'long-long' ? 8 : 4, offset = block.valueOffset;
		if (offset < 3 || offset + width > document.length) throw new Error('Invalid Audacity block byte position.');
		const stored = width === 8 ? Number(view.getBigInt64(offset, true)) : view.getInt32(offset, true);
		if (stored !== block.blockId) throw new Error('The native block identity changed after inspection.');
		if (width === 8) view.setBigInt64(offset, -BigInt(block.samples), true);
		else view.setInt32(offset, -block.samples, true);
	}
	return sql.transaction(() => {
		sql.exec(`UPDATE ${table} SET doc=? WHERE id=1 AND dict=? AND doc=?`, [document, dictionary, original]);
		if (Number(sql.value('SELECT changes()')) !== 1) throw new Error('The native document changed before repair.');
		const checked = inspectAudacityRecovery(database);
		if (checked.integrity !== 'ok' || checked.missing.length || !checked.documents.some(item => item.source === table && item.readable)) throw new Error('The repaired native copy failed verification.');
		return { repairedReferences: inspection.missing.length };
	});
}
