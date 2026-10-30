#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/** Import selected handoff artifacts from an Update AI assets run. */

import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
	createDesktopTestRuntimeSnapshot,
	DESKTOP_TEST_RUNTIME_TARGETS,
} from './lib/desktop-test-assistance-runtime-snapshots.mjs';

if (process.argv.length !== 3) {
	throw new Error('Usage: node scripts/refresh-desktop-test-runtime-snapshots.mjs <downloaded-handoffs-root>');
}
const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(process.argv[2]);
const snapshotRoot = resolve(root, 'config/desktop-test-assistance-runtime-snapshots');
const lockPath = resolve(root, 'config/desktop-test-assistance-runtime-snapshots.json');
const previous = await readFile(lockPath, 'utf8').then(JSON.parse).catch((error) => {
	if (error.code === 'ENOENT') return { schemaVersion: 1, targets: {} };
	throw error;
});
if (previous.schemaVersion !== 1 || !previous.targets || typeof previous.targets !== 'object') {
	throw new Error('The desktop test runtime snapshot register is invalid.');
}
const retainedPath = resolve(root, 'config/assistance-sherpa-retained-builds.json');
const retained = JSON.parse(await readFile(retainedPath, 'utf8'));
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const snapshots = [];
for (const targetId of DESKTOP_TEST_RUNTIME_TARGETS) {
	let handoffRoot = resolve(sourceRoot, `assistance-runtime-handoff-${targetId}`);
	let source = await lstat(handoffRoot).catch((error) => {
		if (error.code === 'ENOENT') return null;
		throw error;
	});
	if (source === null) {
		handoffRoot = resolve(sourceRoot, targetId);
		source = await lstat(handoffRoot).catch((error) => {
			if (error.code === 'ENOENT') return null;
			throw error;
		});
	}
	if (source === null) continue;
	if (!source.isDirectory() || source.isSymbolicLink()) throw new Error(`Invalid handoff directory for ${targetId}.`);
	const bytes = await createDesktopTestRuntimeSnapshot({ handoffRoot, targetId });
	const handoff = JSON.parse(await readFile(resolve(handoffRoot, 'handoff.json'), 'utf8'));
	const { sourceRevision } = handoff;
	const native = JSON.parse(await readFile(resolve(handoffRoot, 'config/assistance-native-runtime-manifest.json'), 'utf8'));
	const receipt = handoff.assistanceNativeBuild;
	retained.targets[targetId] = {
		sourceRevision, receiptSha256: fingerprint(receipt),
		packageSha256: [...new Set([native.targets[targetId].package, receipt.manifest.targets[targetId].package]
			.map(fingerprint))],
	};
	snapshots.push({ targetId, bytes, sourceRevision });
}
if (snapshots.length === 0) throw new Error('No desktop test runtime handoffs were provided.');
const targets = { ...previous.targets };
for (const { targetId, bytes, sourceRevision } of snapshots) {
	targets[targetId] = {
		sourceRevision, byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	};
}
if (DESKTOP_TEST_RUNTIME_TARGETS.some((targetId) => !targets[targetId])) {
	throw new Error('The desktop test runtime snapshots need all five targets before committing.');
}
await mkdir(snapshotRoot, { recursive: true });
for (const { targetId, bytes } of snapshots) {
	await writeFile(resolve(snapshotRoot, `${targetId}.json.gz`), bytes);
}
await writeFile(lockPath,
	`${JSON.stringify({ schemaVersion: 1, targets }, null, '\t')}\n`);
await writeFile(retainedPath, `${JSON.stringify(retained, null, '\t')}\n`);
console.log(`Refreshed ${snapshots.length} desktop test runtime snapshots.`);
