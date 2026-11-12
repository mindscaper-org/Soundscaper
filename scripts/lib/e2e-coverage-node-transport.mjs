/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { sha256Digest } from './e2e-coverage-integrity.mjs';

export function qualifiedEvidencePath(root, path) {
	assert.ok(typeof path === 'string' && path !== '' && !isAbsolute(path) && !path.includes('\\')
		&& path.split('/').every(part => part !== '' && part !== '.' && part !== '..'), 'evidence needs a safe relative path');
	let current = resolve(root);
	assert.ok(lstatSync(current).isDirectory() && !lstatSync(current).isSymbolicLink(), 'evidence root needs a regular directory');
	for (const part of path.split('/')) {
		current = join(current, part);
		assert.ok(!lstatSync(current).isSymbolicLink(), 'evidence must not contain symbolic links');
	}
	return current;
}

export function qualifiedEvidenceFiles(root) {
	const files = [];
	visit(resolve(root));
	return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	function visit(directory) {
		assert.ok(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(), 'evidence root needs a regular directory');
		for (const name of readdirSync(directory).sort()) {
			const path = join(directory, name), metadata = lstatSync(path);
			assert.ok(!metadata.isSymbolicLink(), 'evidence must not contain symbolic links');
			if (metadata.isDirectory()) visit(path);
			else {
				assert.ok(metadata.isFile(), 'evidence needs regular files');
				const bytes = readFileSync(path);
				files.push({ path: relative(root, path).replaceAll('\\', '/'), sha256: sha256Digest(bytes), byteLength: bytes.byteLength });
			}
		}
	}
}

/**
 * Copies original receipts, prepared artifacts and raw profiles without rewriting any bytes.
 * @param {{inputRoots?: readonly string[], outputRoot: string}} options
 */
export function copyQualifiedNodeEvidence({ inputRoots = [], outputRoot }) {
	if (inputRoots.length === 0) return undefined;
	assert.equal(new Set(inputRoots.map(root => resolve(root))).size, inputRoots.length, 'duplicate Node evidence root');
	const entries = inputRoots.map((root, index) => {
		const files = qualifiedEvidenceFiles(root);
		assert.ok(files.some(file => file.path === 'manifest.json'), 'Node evidence needs manifest.json');
		const path = `node-evidence/${String(index).padStart(6, '0')}`;
		const destination = resolve(outputRoot, path);
		const nested = relative(resolve(root), destination);
		assert.ok(nested === '..' || nested.startsWith(`..${sep}`) || isAbsolute(nested), 'Node evidence output must not be inside its input');
		assert.ok(!existsSync(destination), 'Node evidence destination must be fresh');
		mkdirSync(dirname(destination), { recursive: true }); cpSync(root, destination, { recursive: true });
		assert.deepEqual(qualifiedEvidenceFiles(destination), files, 'copied evidence hashes and bytes must stay exact');
		return { path, files };
	});
	const path = 'node-evidence/index.json';
	const bytes = Buffer.from(`${JSON.stringify({ kind: 'soundscaper-qualified-node-evidence-index', schemaVersion: 1, entries }, null, 2)}\n`);
	writeFileSync(resolve(outputRoot, path), bytes);
	return { path, sha256: sha256Digest(bytes) };
}

export function readQualifiedNodeEvidenceIndex({ root, locator }) {
	if (locator === undefined) return [];
	assert.deepEqual(Object.keys(locator).sort(), ['path', 'sha256'], 'Node evidence locator fields');
	const bytes = readFileSync(qualifiedEvidencePath(root, locator.path));
	assert.equal(sha256Digest(bytes), locator.sha256, 'Node evidence index digest mismatch');
	const index = JSON.parse(bytes.toString('utf8'));
	assert.deepEqual(Object.keys(index).sort(), ['entries', 'kind', 'schemaVersion'], 'Node evidence index fields');
	assert.equal(index.kind, 'soundscaper-qualified-node-evidence-index'); assert.equal(index.schemaVersion, 1);
	assert.ok(Array.isArray(index.entries) && index.entries.length > 0, 'Node evidence index entries required');
	assert.equal(new Set(index.entries.map(entry => entry.path)).size, index.entries.length, 'duplicate Node evidence locators');
	return index.entries.map(entry => {
		assert.deepEqual(Object.keys(entry).sort(), ['files', 'path'], 'Node evidence entry fields');
		const directory = qualifiedEvidencePath(root, entry.path);
		assert.deepEqual(qualifiedEvidenceFiles(directory), entry.files, 'Node evidence file hashes or bytes differ');
		return directory;
	});
}
