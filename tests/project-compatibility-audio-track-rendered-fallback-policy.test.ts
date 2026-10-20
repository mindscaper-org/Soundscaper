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
	'src/common/editor/project-feature-audio-track-render-v1.ts',
	'src/common/editor/project-feature-audio-rendered-fallback.ts',
	'tests/audio-editor-project-feature-audio-track-render-v1.test.ts',
] as const;
const DELIVERY_EVIDENCE = [
	'tests/audio-editor-audio-track-render-fallback-delivery.test.ts',
	'tests/audio-editor-audio-rendered-fallback-export-service.test.ts',
] as const;
const PORTABILITY_EVIDENCE = [
	'tests/audio-editor-scape-audio-track-fallback-roundtrip.test.ts',
] as const;
const HANDOFF_EVIDENCE = [
	'tests/audio-editor-soundscaper-baseline.test.ts',
] as const;

test('compatibility policy narrowly qualifies the track-local audio-effects render relationship', async () => {
	const policy = await compatibilityPolicy();
	const rule = compatibilityRule(policy, 'current-audio-track-rendered-fallback');
	assert.equal(rule.status, 'implemented');
	await assertCompatibilityEvidence(rule, PROJECTOR_EVIDENCE);
	await assertCompatibilityEvidence(rule, DELIVERY_EVIDENCE);
	await assertCompatibilityEvidence(rule, PORTABILITY_EVIDENCE);
	await assertCompatibilityEvidence(rule, HANDOFF_EVIDENCE);
});

test('the schema rule owns the closed track relationship', async () => {
	const policy = await compatibilityPolicy();
	const core = compatibilityRule(policy, 'project-feature-requirements-core');
	assertEvidencePaths(core.evidence, [
		'src/common/editor/project-feature-audio-track-render-v1.ts',
		'tests/audio-editor-project-feature-audio-track-render-v1.test.ts',
	]);
});

test('security controls bind the track relationship through playback, integrity, and delivery', async () => {
	const matrix = await securityMatrix();
	const projectDocuments = securityRisk(matrix, 'external-project-document-validation');
	const playback = securityControl(projectDocuments, 'audio-rendered-fallback-playback');
	const delivery = securityControl(projectDocuments, 'audio-rendered-fallback-export');
	securityControl(projectDocuments, 'controller-rendered-fallback-admission');
	await assertSecurityEvidence(playback, [...PROJECTOR_EVIDENCE.slice(0, 1), ...HANDOFF_EVIDENCE]);
	await assertSecurityEvidence(delivery, [...DELIVERY_EVIDENCE.slice(0, 1), ...PORTABILITY_EVIDENCE, ...HANDOFF_EVIDENCE]);
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
