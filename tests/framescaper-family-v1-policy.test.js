/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('Framescaper editing behavior is governed by direct family-v1 authority', async () => {
	const register = await json('config/project-compatibility.json');
	const rules = new Map(register.rules.map((rule) => [rule.id, rule]));
	for (const id of [
		'family-v1-product-isolation',
		'framescaper-v1-nested-sequence-native',
		'framescaper-v1-multicamera-native',
		'framescaper-v1-video-proxy-preservation',
	]) {
		const rule = rules.get(id);
		assert.ok(rule, id);
		assert.equal(rule.status, 'implemented', id);
		assert.equal(rule.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
		for (const reference of rule.evidence) await evidenceExists(reference);
	}
});

test('security selects family-v1 admission and desktop isolation', async () => {
	const security = await json('config/production-security-matrix.json');
	const risks = new Map(security.risks.map((risk) => [risk.id, risk]));
	for (const [riskId, controlId] of [
		['external-project-document-validation', 'framescaper-v1-editorial-document-admission'],
		['external-media-parser-bounds', 'framescaper-v1-proxy-revalidation'],
		['shared-desktop-project-library-integrity', 'framescaper-v1-desktop-isolation'],
		['shared-desktop-project-library-integrity', 'family-v1-desktop-library-isolation'],
	]) {
		const control = risks.get(riskId)?.currentControls.find(({ id }) => id === controlId);
		assert.ok(control, `${riskId}/${controlId}`);
		assert.equal(control.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
		for (const reference of control.evidence) await evidenceExists(reference.path);
	}
});

test('current timing fixtures and desktop lease activation remain registered', async () => {
	const fixtures = await json('config/milestone-3-timing-probe-fixtures.json');
	assert.equal(fixtures.fixtures.length, 5);
	const compatibility = await json('config/project-compatibility.json');
	assert.equal(compatibility.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections').status, 'implemented');
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}

async function evidenceExists(reference) {
	const [path] = reference.split('#');
	await assert.doesNotReject(access(new URL(path, root)), `missing evidence ${reference}`);
}
