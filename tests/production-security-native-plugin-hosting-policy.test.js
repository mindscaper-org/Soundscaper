/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

test('native plug-in controls retain distinct execution, format, and containment evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.ok(risk);
	const controls = new Map(risk.currentControls.map((control) => [control.id, control]));

	const fence = controls.get('menu-reached-plugin-hosting-surface');
	assert.ok(fence, 'the surface control must say what is and is not machine-runnable');
	assertEvidence(fence, [
		'desktop/preload.mjs',
		'desktop/plugin-registration.mjs',
		'desktop/plugin-registry.ts',
		'desktop/plugin-host-service.ts',
		'desktop/native-audio-session-service.ts',
		'desktop/plugin-vendor-window-authority.mjs',
		'desktop/native-child-isolation-launcher.ts',
		'src/soundscaper/editor-native-plugin-actions.ts',
		'desktop/framescaper-openfx-frame-execution.ts',
		'desktop/professional-candidate-custody.ts',
		'tests/desktop-professional-candidate-custody.test.ts',
		'tests/desktop-protocol.test.js',
		'tests/desktop-plugin-registry.test.ts',
		'tests/desktop-plugin-host-service.test.ts',
		'tests/desktop-native-child-isolation-launcher.test.ts',
		'tests/desktop-openfx-producer-live-replay.test.ts',
		'tests/production-licensing-matrix.test.js',
	]);

	const execution = controls.get('out-of-process-plugin-host-execution');
	assert.ok(execution, 'the hosting path that exists must be recorded as auditable');
	assertEvidence(execution, [
		'desktop/helper-job-grant.ts',
		'desktop/native-helper-host-job.js',
		'desktop/native-helper-process.js',
		'desktop/plugin-host-isolation.ts',
		'native/soundscaper-helper-addon/src/plugin_host.c',
		'tests/desktop-helper-contract.test.ts',
		'tests/desktop-native-helper-host-job.test.js',
		'tests/desktop-plugin-host-isolation.test.ts',
		'tests/native-fixture-plugin-format.test.js',
	]);

	const formats = controls.get('ladspa-effect-and-vamp-analyzer-contracts');
	assert.ok(formats, 'LADSPA effects and Vamp analyzers must retain distinct contracts');
	assertEvidence(formats, [
		'desktop/preload.mjs',
		'desktop/vamp-analyzer-contract.ts',
		'desktop/vamp-analyzer-session.ts',
		'desktop/vamp-analyzer-allowance-store.mjs',
		'desktop/native-vamp-analyzer-helper-backend.ts',
		'native/soundscaper-professional-host/src/juce_plugin_adapter.cpp',
		'native/soundscaper-professional-host/src/vamp_analyzer_peer.cpp',
		'tests/audio-editor-ladspa-format.test.ts',
		'tests/desktop-vamp-analyzer-contract.test.ts',
		'tests/desktop-preload-vamp-analyzer.test.js',
	]);

	const containment = controls.get('digest-keyed-plugin-consent-isolation-and-quarantine');
	assert.ok(containment, 'consent, isolation and quarantine are controls that exist');
	assertEvidence(containment, [
		'desktop/plugin-consent.ts',
		'desktop/plugin-quarantine.ts',
		'desktop/plugin-instance-state.ts',
		'desktop/plugin-host-isolation.ts',
		'tests/desktop-plugin-consent.test.ts',
		'tests/desktop-plugin-quarantine.test.ts',
		'tests/desktop-plugin-instance-state.test.ts',
		'tests/desktop-plugin-host-isolation.test.ts',
	]);
});

test('native plug-in and helper risks retain their conditional status and named residuals', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risk = matrix.risks.find(({ id }) => id === 'native-plugin-hosting');
	assert.equal(risk.status, 'partial');
	assert.equal(risk.surfaceDisposition, 'conditional');
	const residuals = new Map(risk.residualRisks.map((residual) => [residual.id, residual]));

	const authority = residuals.get('hosted-plugin-ambient-authority');
	assert.ok(authority, 'ambient authority must remain a named residual risk');

	const unexercised = residuals.get('unexercised-plugin-hosting-gates');
	assert.ok(unexercised, 'the unexercised hosting gates must remain a named residual risk');
	const helper = matrix.risks.find(({ id }) => id === 'native-helper-processes');
	const residual = helper.residualRisks.find(({ id }) => id === 'native-helper-supervision');
	assert.ok(residual, 'the helper supervision residual risk must remain recorded');
});

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.equal(evidence.has(path), true, path);
}
