/* SPDX-License-Identifier: AGPL-3.0-only */
import { nativeCloudMetadata } from './audiocom-native-project.ts';

interface Rows { rows(sql: string, bind?: readonly unknown[]): readonly (readonly unknown[])[] }
const bytes = (value: unknown): Uint8Array<ArrayBuffer> => {
	if (!(value instanceof Uint8Array)) throw new Error('Invalid native cloud project data.');
	return new Uint8Array(value);
};
export function nativeCloudManifest(database: Rows) {
	const row = database.rows('SELECT dict, doc FROM project WHERE id=1')[0];
	if (!row) throw new Error('The cloud project has no committed document.');
	const blocks = database.rows('SELECT blockid, sampleformat, length(samples) FROM sampleblocks ORDER BY blockid').map(([id, format, size]) => {
		if (!Number.isSafeInteger(id) || Number(id) < 1 || Number(id) > 0xffffffff || format !== 262159
			|| !Number.isSafeInteger(size) || Number(size) < 4 || Number(size) > 64 * 1024 * 1024 || Number(size) % 4) throw new Error('Unsupported cloud sample block.');
		return { id: Number(id), size: Number(size) };
	});
	return { metadata: nativeCloudMetadata(bytes(row[0]), bytes(row[1])), blocks };
}
export function nativeCloudPcm(database: Rows, id: unknown): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(id) || Number(id) < 1) throw new Error('Invalid cloud sample block id.');
	const row = database.rows('SELECT samples FROM sampleblocks WHERE blockid=?', [id])[0];
	if (!row) throw new Error('The cloud sample block is missing.');
	return bytes(row[0]);
}
