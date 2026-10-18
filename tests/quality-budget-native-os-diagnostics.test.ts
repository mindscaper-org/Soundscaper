/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID,
	validateNativeOsDiagnosticBinding,
	validateNativeOsDiagnosticsEnvironment,
} from '../scripts/lib/native-os-diagnostics-schema.mjs';

const environment = Object.freeze({
	id: NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID,
	status: 'active',
	kind: 'observed-native-runtime-diagnostics',
	rendererRequirement: 'any',
	evidence: Object.freeze(['scripts/collect-m5-native-helper-quality.mjs']),
});

function observedHost(platformId = 'linuxX64') {
	return {
		hostId: `diagnostic-${platformId}-01`,
		platformId,
		architecture: platformId.endsWith('Arm64') ? 'arm64' : 'x64',
		osImage: 'Local diagnostic image',
		osVersion: '1.0',
		cpuModel: 'Observed CPU',
		logicalCpuCount: 16,
		memoryBytes: 34_359_738_368,
		gpuModel: 'Observed GPU',
		driverVersion: '1.0',
		audioInterfaceModel: 'Observed loopback interface',
		audioDriverVersion: '1.0',
		displayIdentity: 'Observed display',
	};
}

function artifacts() {
	return {
		sourceRevision: 'a'.repeat(40),
		packageSha256: '1'.repeat(64),
		helperBinarySha256: '2'.repeat(64),
		nativeAddonSha256: '3'.repeat(64),
		mediaHostSha256: null,
		workloadRunnerSha256: '4'.repeat(64),
		ofxScannerSha256: null,
		ofxRuntimeHostSha256: null,
	};
}

test('native OS diagnostics use an observed-runtime descriptor', () => {
	const validated = validateNativeOsDiagnosticsEnvironment(environment);
	assert.equal(validated.id, 'native-os-diagnostics');
	assert.equal(validated.kind, 'observed-native-runtime-diagnostics');
});

test('a diagnostic binds the host and artifacts that actually ran it', () => {
	const measurement = validateNativeOsDiagnosticBinding({
		schemaVersion: 2,
		environmentId: NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID,
		platformId: 'linuxX64',
		observedHost: observedHost(),
		artifacts: artifacts(),
	}, environment);
	assert.equal(measurement.observedHost.audioInterfaceModel, 'Observed loopback interface');
	assert.equal(measurement.artifacts.packageSha256, '1'.repeat(64));
});

test('diagnostic bindings reject host relabelling and unknown fields', () => {
	const binding = {
		schemaVersion: 2,
		environmentId: NATIVE_OS_DIAGNOSTICS_ENVIRONMENT_ID,
		platformId: 'linuxX64',
		observedHost: observedHost('windowsX64'),
		artifacts: artifacts(),
	};
	assert.throws(
		() => validateNativeOsDiagnosticBinding(binding, environment),
		/host identity.*linuxX64/iu,
	);
	assert.throws(
		() => validateNativeOsDiagnosticBinding({
			...binding,
			observedHost: { ...observedHost(), packageSha256: '1'.repeat(64) },
		}, environment),
		/observed host.*exact fields/iu,
	);
	assert.throws(
		() => validateNativeOsDiagnosticBinding({ ...binding, extra: true }, environment),
		/diagnostic binding.*exact fields/iu,
	);
});
