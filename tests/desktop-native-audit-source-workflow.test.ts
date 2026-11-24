/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('desktop audit transfers additional Framescaper archives without duplicating the professional sources', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const sources = extractJob(workflow, 'milestone-5-native-audit-source');
	assert.match(sources, /needs: quality/u);
	assert.match(sources, /contains\(fromJSON\(needs\.quality\.outputs\.release-products\), 'framescaper'\)/u);
	assert.match(sources, /provision-milestone-5-native-sources\.mjs --framescaper-audit-extra/u);
	assert.doesNotMatch(sources, /name: desktop-professional-native-source-cache|--check/u);
	assert.match(sources, /name: desktop-framescaper-audit-source-archives[\s\S]*?\*\/\*\.tar\.gz[\s\S]*?compression-level: 0/u);

	const packages = extractJob(workflow, 'package');
	assert.match(packages, /needs: \[[^\n]*milestone-5-native-audit-source\]/u);
	assert.match(packages, /name: desktop-professional-native-source-cache[\s\S]*?--restore-archives --soundscaper-professional/u);
	assert.match(packages, /if: matrix\.product == 'framescaper'[\s\S]*?name: desktop-framescaper-audit-source-archives[\s\S]*?--restore-archives --framescaper-audit-extra/u);

	const build = extractJob(workflow, 'professional-native-build');
	assert.match(build, /source-cache-artifact: desktop-professional-native-source-cache/u);
	const release = extractJob(workflow, 'release-inventory');
	assert.match(release, /name: desktop-professional-native-source-cache[\s\S]*?--restore-archives --soundscaper-professional/u);
	assert.match(release, /if: github\.ref_type == 'tag' && contains\(fromJSON\(needs\.quality\.outputs\.release-products\), 'framescaper'\)[\s\S]*?name: desktop-framescaper-audit-source-archives[\s\S]*?--restore-archives --framescaper-audit-extra/u);
});
