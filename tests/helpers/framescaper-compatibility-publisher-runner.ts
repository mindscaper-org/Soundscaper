/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFramescaperCompatibilityArchive, type CompatibilityPcmInput } from './framescaper-compatibility-publisher.ts';

async function main(): Promise<void> {
	const path = process.argv[2]; assert.ok(path);
	const inputs: unknown = JSON.parse(await readFile(path, 'utf8')); assert.ok(Array.isArray(inputs));
	const files: CompatibilityPcmInput[] = [];
	for (const value of inputs) {
		assert.ok(value && typeof value === 'object');
		const row = value as Record<string, unknown>;
		assert.ok(typeof row.name === 'string' && typeof row.path === 'string' && typeof row.frequency === 'number');
		assert.ok(Array.isArray(row.amplitudes) && row.amplitudes.length === 2);
		const left: unknown = row.amplitudes[0], right: unknown = row.amplitudes[1];
		assert.ok(typeof left === 'number' && typeof right === 'number');
		files.push({ name: row.name, bytes: await readFile(row.path), frequency: row.frequency, amplitudes: [left, right] });
	}
	const result = await createFramescaperCompatibilityArchive(files);
	process.stdout.write(Buffer.concat([Buffer.from(`${JSON.stringify(result.projectId)}\n`), Buffer.from(result.bytes)]));
}

void main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
