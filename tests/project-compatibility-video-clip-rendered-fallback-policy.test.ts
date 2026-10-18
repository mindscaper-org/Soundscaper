/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const compatibilityPolicyUrl = new URL('../config/project-compatibility.json', import.meta.url);
const securityMatrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);

interface CompatibilityRule {
	readonly id: string;
	readonly status: string;
	readonly requiredOutcome: string;
	readonly currentBehavior: string;
	readonly evidence: readonly string[];
}

interface SecurityControl {
	readonly id: string;
	readonly summary: string;
	readonly evidence: ReadonlyArray<Readonly<{ kind: string; path: string }>>;
}

interface SecurityRisk {
	readonly id: string;
	readonly currentControls: readonly SecurityControl[];
}

const PROJECTOR_EVIDENCE = [
	'src/common/editor/project-feature-video-clip-render-v1.ts',
	'src/common/editor/project-feature-video-rendered-fallback.ts',
	'tests/audio-editor-project-feature-video-clip-render-v1.test.ts',
] as const;

const INTEGRITY_EVIDENCE = [
	'src/common/editor/project-fallback-integrity-snapshot.ts',
	'tests/audio-editor-project-fallback-integrity-relationships.test.ts',
] as const;
const EXPORT_EVIDENCE = [
	'tests/audio-editor-video-rendered-fallback-delivery-projection.test.ts',
	'tests/audio-editor-video-clip-fallback-export-regression.test.ts',
] as const;
const PORTABILITY_EVIDENCE = [
	'tests/audio-editor-scape-video-clip-fallback-roundtrip.test.ts',
	'tests/audio-editor-framescaper-baseline.test.ts',
] as const;

test('compatibility policy owns the closed rendered-fallback relationship schema', async () => {
	const policy = await compatibilityPolicy();
	const core = compatibilityRule(policy, 'project-feature-requirements-core');
	assert.equal(core.status, 'implemented');
	assertEvidencePaths(core.evidence, [
		'src/common/editor/project-feature-requirements.ts',
		'tests/audio-editor-project-feature-requirements.test.ts',
	]);
});

test('compatibility policy narrowly qualifies target-only video-effects clip projection and delivery', async () => {
	const policy = await compatibilityPolicy();
	const playback = compatibilityRule(policy, 'current-video-rendered-fallback-playback');
	const integrity = compatibilityRule(policy, 'current-controller-rendered-fallback-integrity');
	assert.equal(playback.status, 'implemented');
	await assertCompatibilityEvidence(playback, PROJECTOR_EVIDENCE);
	await assertCompatibilityEvidence(playback, EXPORT_EVIDENCE);
	await assertCompatibilityEvidence(integrity, INTEGRITY_EVIDENCE);
});

test('compatibility policy binds portable Scape and managed handoff witnesses', async () => {
	const policy = await compatibilityPolicy();
	const scape = compatibilityRule(policy, 'current-scape-feature-requirements');
	compatibilityRule(policy, 'current-scape-rendered-fallback-integrity');
	const handoff = compatibilityRule(policy, 'current-video-rendered-fallback-playback');
	await assertCompatibilityEvidence(scape, PORTABILITY_EVIDENCE.slice(0, 1));
	await assertCompatibilityEvidence(handoff, PORTABILITY_EVIDENCE.slice(1));
});

test('security controls bind the clip relationship through playback, integrity, and export', async () => {
	const matrix = await securityMatrix();
	const projectDocuments = securityRisk(matrix, 'external-project-document-validation');
	const playback = securityControl(projectDocuments, 'video-rendered-fallback-playback');
	const delivery = securityControl(projectDocuments, 'video-rendered-fallback-export');
	await assertSecurityEvidence(playback, PROJECTOR_EVIDENCE);
	await assertSecurityEvidence(playback, PORTABILITY_EVIDENCE.slice(1));
	await assertSecurityEvidence(delivery, [...INTEGRITY_EVIDENCE, ...EXPORT_EVIDENCE]);
});

async function compatibilityPolicy(): Promise<Readonly<{ rules: readonly CompatibilityRule[] }>> {
	return JSON.parse(await readFile(compatibilityPolicyUrl, 'utf8')) as Readonly<{
		rules: readonly CompatibilityRule[];
	}>;
}

async function securityMatrix(): Promise<Readonly<{ risks: readonly SecurityRisk[] }>> {
	return JSON.parse(await readFile(securityMatrixUrl, 'utf8')) as Readonly<{
		risks: readonly SecurityRisk[];
	}>;
}

function compatibilityRule(
	policy: Readonly<{ rules: readonly CompatibilityRule[] }>,
	id: string,
): CompatibilityRule {
	const rule = policy.rules.find((candidate) => candidate.id === id);
	if (!rule) throw new ReferenceError(`Missing compatibility rule ${id}.`);
	return rule;
}

function securityRisk(
	matrix: Readonly<{ risks: readonly SecurityRisk[] }>,
	id: string,
): SecurityRisk {
	const risk = matrix.risks.find((candidate) => candidate.id === id);
	if (!risk) throw new ReferenceError(`Missing security risk ${id}.`);
	return risk;
}

function securityControl(risk: SecurityRisk, id: string): SecurityControl {
	const control = risk.currentControls.find((candidate) => candidate.id === id);
	if (!control) throw new ReferenceError(`Missing security control ${id}.`);
	return control;
}

function assertEvidencePaths(actual: readonly string[], expected: readonly string[]): void {
	for (const path of expected) assert.ok(actual.includes(path), `missing policy evidence: ${path}`);
}

async function assertCompatibilityEvidence(
	rule: CompatibilityRule,
	paths: readonly string[],
): Promise<void> {
	assertEvidencePaths(rule.evidence, paths);
	await assertExistingPaths(paths);
}

async function assertSecurityEvidence(control: SecurityControl, paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		assert.ok(control.evidence.some((item) => item.path === path), `missing security evidence: ${path}`);
	}
	await assertExistingPaths(paths);
}

async function assertExistingPaths(paths: readonly string[]): Promise<void> {
	for (const path of paths) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
}
