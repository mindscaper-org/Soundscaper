/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ownerOfModulePath, parseModulePolicy } from '../scripts/lib/module-policy.ts';
import { planModuleTests } from '../scripts/lib/module-test-plan.ts';

const policy = parseModulePolicy(JSON.parse(readFileSync(new URL('../config/module-policy.json', import.meta.url), 'utf8')) as unknown);
const photoTest = 'tests/lightscaper-photo-library-session.test.ts';
const photoBrowser = 'tests/browser/lightscaper-develop-workspace.spec.js';
const handoffBrowser = 'tests/browser/lightscaper-photo-framescaper-handoff.spec.js';
const current = new Map([
	['src/common/imaging/image-format-signature.ts', 'export const identify = () => null;'],
	['src/lightscaper/catalog/photo-document.ts', 'export const photo = 1;'],
	[photoTest, "import '../src/lightscaper/catalog/photo-document.ts';"],
	[photoBrowser, ''],
	[handoffBrowser, ''],
]);

test('photo application, presentation and native services retain Lightscaper ownership', () => {
	for (const path of ['src/lightscaper/catalog/photo-document.ts', 'src/common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx',
		'desktop/lightscaper-native-photo-media-current-v1.ts', 'native/lightscaper-photo-native-current-v1/main.cpp']) {
		assert.equal(ownerOfModulePath(policy, path)?.id, 'lightscaper', path);
	}
});

test('named Lightscaper target includes its workflows and all required product origins', () => {
	const plan = planModuleTests({ policy, current, changedPaths: [], modules: ['lightscaper'],
		nodeTests: [photoTest], browserTests: [photoBrowser, handoffBrowser] });
	assert.equal(plan.mode, 'focused');
	assert.deepEqual(plan.nodeTests, [photoTest]);
	assert.deepEqual(plan.browserTests, [photoBrowser, handoffBrowser].sort());
	assert.deepEqual(plan.products, ['framescaper', 'lightscaper', 'soundscaper']);
});

test('neutral imaging changes select declared photo integration alongside Frame consumers', () => {
	const plan = planModuleTests({ policy, current, changedPaths: ['src/common/imaging/image-format-signature.ts'],
		nodeTests: [], browserTests: [photoBrowser] });
	assert.equal(plan.mode, 'focused');
	assert.ok(plan.browserTests.includes(photoBrowser));
	assert.ok(plan.products.includes('lightscaper'));
});

test('photo-owned changes retain the complete coverage union until independently qualified', () => {
	const plan = planModuleTests({ policy, current, changedPaths: ['src/lightscaper/catalog/photo-document.ts'],
		nodeTests: [photoTest], browserTests: [photoBrowser] });
	assert.equal(plan.mode, 'full');
	assert.ok(plan.reasons.includes('Module lightscaper still requires the complete coverage union.'));
	assert.deepEqual(plan.products, ['framescaper', 'lightscaper', 'soundscaper']);
});
