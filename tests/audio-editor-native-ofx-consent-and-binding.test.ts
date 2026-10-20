/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	clearOfxQuarantine,
	enableOfxPlugin,
	grantOfxScanConsent,
	ofxPluginMayRun,
	reconcileOfxConsent,
	recordOfxFailure,
	revokeOfxPlugin,
	OFX_IMMEDIATE_QUARANTINE_FAILURES,
	OFX_QUARANTINE_WINDOW_MS,
	OfxConsentError,
	type OfxConsentRecordV1,
} from '../src/common/editor/native-ofx-consent.ts';
import {
	assertOfxEffectBindingV1,
	OfxBindingError,
	type OfxEffectBindingV1,
} from '../src/common/editor/native-ofx-binding.ts';
import type { OfxPluginDescriptorV1 } from '../src/common/editor/native-ofx-descriptor.ts';

const DIGEST = 'a'.repeat(64);
const OTHER_DIGEST = 'b'.repeat(64);

test('a discovered binary may not run until it is consented to and enabled', () => {
	const discovered = reconcileOfxConsent(null, descriptor());
	assert.equal(discovered.state, 'discovered');
	assert.equal(ofxPluginMayRun(discovered), false);

	assert.throws(() => enableOfxPlugin(discovered), /only after scan consent/u);

	const consented = grantOfxScanConsent(discovered);
	assert.equal(consented.state, 'consented');
	assert.equal(ofxPluginMayRun(consented), false, 'looking is not running');

	const enabled = enableOfxPlugin(consented);
	assert.equal(enabled.state, 'enabled');
	assert.equal(ofxPluginMayRun(enabled), true);
});

test('a replaced binary never inherits the previous consent', () => {
	const enabled = enableOfxPlugin(grantOfxScanConsent(reconcileOfxConsent(null, descriptor())));
	const rescanned = reconcileOfxConsent(enabled, descriptor({ binarySha256: OTHER_DIGEST }));

	assert.equal(rescanned.state, 'discovered');
	assert.equal(ofxPluginMayRun(rescanned), false);
	assert.equal(rescanned.binarySha256, OTHER_DIGEST);
	// Rescanning the same bytes keeps the record exactly as it was.
	assert.strictEqual(reconcileOfxConsent(enabled, descriptor()), enabled);
});

test('revoking stops a plug-in running and keeps its identity', () => {
	const enabled = enableOfxPlugin(grantOfxScanConsent(reconcileOfxConsent(null, descriptor())));
	const revoked = revokeOfxPlugin(enabled);

	assert.equal(revoked.state, 'revoked');
	assert.equal(ofxPluginMayRun(revoked), false);
	assert.equal(revoked.fingerprint, enabled.fingerprint);
});

test('a malformed descriptor or a denied resource quarantines immediately', () => {
	for (const kind of OFX_IMMEDIATE_QUARANTINE_FAILURES) {
		const quarantined = recordOfxFailure(enabled(), kind, 1_000);
		assert.equal(quarantined.state, 'quarantined', kind);
		assert.equal(quarantined.quarantinedAtMs, 1_000, kind);
		assert.equal(ofxPluginMayRun(quarantined), false, kind);
	}
});

test('a crash, hang, or render error needs three occurrences inside a minute', () => {
	let record = enabled();
	record = recordOfxFailure(record, 'crash', 1_000);
	assert.equal(record.state, 'enabled');
	record = recordOfxFailure(record, 'hang', 2_000);
	assert.equal(record.state, 'enabled');
	record = recordOfxFailure(record, 'render-error', 3_000);

	assert.equal(record.state, 'quarantined');
	assert.equal(record.quarantinedAtMs, 3_000);
});

test('failures outside the window never accumulate into quarantine', () => {
	let record = enabled();
	for (const step of [0, 1, 2]) {
		record = recordOfxFailure(record, 'crash', step * (OFX_QUARANTINE_WINDOW_MS + 1));
	}

	assert.equal(record.state, 'enabled');
	assert.equal(record.failures.length, 1);
});

test('nothing leaves quarantine except an explicit clear, which asks again', () => {
	const quarantined = recordOfxFailure(enabled(), 'resource-violation', 10);

	assert.throws(() => grantOfxScanConsent(quarantined), OfxConsentError);
	assert.throws(() => enableOfxPlugin(quarantined), /cannot be enabled until it is cleared/u);
	assert.strictEqual(revokeOfxPlugin(quarantined), quarantined);

	const cleared = clearOfxQuarantine(quarantined);
	assert.equal(cleared.state, 'discovered', 'the user consents and enables again');
	assert.deepEqual(cleared.failures, []);
	assert.equal(cleared.quarantinedAtMs, null);
	assert.strictEqual(clearOfxQuarantine(cleared), cleared);
});

test('a well-formed effect binding is admitted and stores no path', () => {
	assert.doesNotThrow(() => assertOfxEffectBindingV1(binding()));
	assert.throws(
		() => assertOfxEffectBindingV1(binding({ inputs: [{ name: 'Source', sourceRef: 'media/clip.mp4' }] })),
		/references a project object by id, never a path/u,
	);
	assert.throws(
		() => assertOfxEffectBindingV1(binding({ inputs: [{ name: 'Source', sourceRef: 'C:\\clip.mp4' }] })),
		/references a project object by id, never a path/u,
	);
});

test('typed parameter state is validated against its OpenFX type', () => {
	for (const [parameters, pattern] of [
		[[param('radius', 'double', 4)], /must be 1 finite numbers/u],
		[[param('offset', 'double2d', [1])], /must be 2 finite numbers/u],
		[[param('tint', 'rgba', [1, 1, 1])], /must be 4 finite numbers/u],
		[[param('on', 'boolean', 1)], /must be a boolean/u],
		[[param('mode', 'choice', 1.5)], /must be a safe integer/u],
		[[param('label', 'string', 42)], /must be bounded text/u],
		[[param('divider', 'group', 1)], /group parameter carries no value/u],
		[[param('curve', 'parametric', [[0, 0], [1]])], /must be 2 finite numbers/u],
		[[{ ...param('radius', 'double', [1]), extra: 1 }], /exactly its schema keys/u],
	] as const) {
		assert.throws(
			() => assertOfxEffectBindingV1(binding({ parameters })),
			pattern,
			JSON.stringify(parameters),
		);
	}
	assert.doesNotThrow(() => assertOfxEffectBindingV1(binding({
		parameters: [
			param('radius', 'double', [2]),
			param('tint', 'rgba', [1, 0.5, 0.25, 1]),
			param('on', 'boolean', true),
			param('mode', 'choice', 2),
			param('divider', 'group', null),
		],
	})));
});

test('keyframes are ordered, bounded, and never attached to a valueless parameter', () => {
	assert.doesNotThrow(() => assertOfxEffectBindingV1(binding({
		parameters: [{
			...param('radius', 'double', [1]),
			keyframes: [{ frame: 0, value: 1 }, { frame: 10, value: 4 }],
		}],
	})));
	assert.throws(() => assertOfxEffectBindingV1(binding({
		parameters: [{
			...param('radius', 'double', [1]),
			keyframes: [{ frame: 10, value: 1 }, { frame: 10, value: 2 }],
		}],
	})), /strictly ordered by frame/u);
	assert.throws(() => assertOfxEffectBindingV1(binding({
		parameters: [{ ...param('divider', 'group', null), keyframes: [{ frame: 0, value: 1 }] }],
	})), /cannot be keyframed/u);
});

test('a custom encoding must name a custom parameter the binding actually carries', () => {
	assert.doesNotThrow(() => assertOfxEffectBindingV1(binding({
		parameters: [param('shape', 'custom', 'AAAA')],
		customEncodings: { shape: 'AAAA' },
	})));
	assert.throws(() => assertOfxEffectBindingV1(binding({
		customEncodings: { unknown_param: 'AAAA' },
	})), /does not carry/u);
	// A payload attached to a typed parameter would reach a host that has no
	// custom suite to hand it to, and would move the frozen-render digest.
	assert.throws(() => assertOfxEffectBindingV1(binding({
		parameters: [param('radius', 'double', [2])],
		customEncodings: { radius: 'AAAA' },
	})), /not a custom parameter/u);
	assert.throws(() => assertOfxEffectBindingV1(binding({
		parameters: [param('divider', 'group', null)],
		customEncodings: { divider: 'AAAA' },
	})), /not a custom parameter/u);
	assert.throws(() => assertOfxEffectBindingV1(binding({
		parameters: [param('shape', 'custom', 'A')],
		customEncodings: { shape: 'A'.repeat(65_537) },
	})), OfxBindingError);
});

function enabled(): OfxConsentRecordV1 {
	return enableOfxPlugin(grantOfxScanConsent(reconcileOfxConsent(null, descriptor())));
}

function descriptor(overrides: Record<string, unknown> = {}): OfxPluginDescriptorV1 {
	return {
		pluginId: 'net.example.Blur',
		vendor: 'Example',
		version: { major: 1, minor: 0 },
		bundleIdentity: 'dev:1|ino:77',
		binarySha256: DIGEST,
		architectureDirectory: 'Linux-x86-64',
		supportedContexts: ['filter'],
		parameters: [{ name: 'radius', type: 'double', animates: true }],
		components: ['RGBA'],
		pixelDepths: ['float'],
		threading: 'fully-safe',
		renderBackends: ['cpu'],
		requestedSuites: ['OfxImageEffectSuite', 'OfxPropertySuite', 'OfxParameterSuite'],
		...overrides,
	} as OfxPluginDescriptorV1;
}

function param(name: string, type: string, value: unknown) {
	return { name, type, value, keyframes: [] };
}

function binding(overrides: Record<string, unknown> = {}): OfxEffectBindingV1 {
	return {
		bindingId: 'ofx-binding-1',
		pluginId: 'net.example.Blur',
		binarySha256: DIGEST,
		context: 'filter',
		inputs: [{ name: 'Source', sourceRef: 'source-a' }],
		parameters: [param('radius', 'double', [2])],
		customEncodings: {},
		enabled: true,
		frozenRender: null,
		...overrides,
	} as OfxEffectBindingV1;
}
