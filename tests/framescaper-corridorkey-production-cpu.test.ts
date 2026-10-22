/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';

import { CORRIDORKEY_GRAPH_ARTIFACTS_V1 } from '../desktop/assistance-corridorkey-model.ts';
import { validateAssistanceRuntimeDistribution } from '../desktop/assistance-runtime-distribution.ts';
import { createCorridorKeyCpuDiagnosticFrameV1 } from '../scripts/models/validate-corridorkey-production-cpu-candidate.ts';

interface FilePin { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface CpuReport {
	readonly schemaVersion: number;
	readonly status: string;
	readonly publicationReady: boolean;
	readonly gpuValidated: boolean;
	readonly modelId: string;
	readonly environment: { readonly target: string; readonly node: string; readonly runtimeVersion: string };
	readonly runtime: { readonly provider: string; readonly snapshot: FilePin & { readonly sourceRevision: string };
		readonly archive: { readonly url: string; readonly byteLength: number; readonly sha256: string }; readonly fileCount: number };
	readonly provenance: { readonly conversionReport: FilePin; readonly sourceRegister: FilePin;
		readonly toolchainLock: FilePin; readonly processorSources: readonly FilePin[]; readonly runnerSources: readonly FilePin[] };
	readonly reference: { readonly sourceRevision: string; readonly trackedSourceFiles: number;
		readonly fixture: { readonly name: string; readonly width: number; readonly height: number;
			readonly frameCount: number; readonly referenceRgbaSha256: string } };
	readonly graphs: readonly { readonly role: string; readonly fileName: string; readonly byteLength: number; readonly sha256: string }[];
	readonly sessions: readonly { readonly fileName: string; readonly providers: readonly string[] }[];
	readonly frames: readonly { readonly ordinal: number; readonly inputRgbaSha256: string; readonly referenceRgbaSha256: string;
		readonly nativeRgbaSha256: string; readonly maximumRgbaError: number;
		readonly transparent: number; readonly partial: number; readonly opaque: number }[];
	readonly invocation: readonly string[];
}

const root = new URL('../', import.meta.url);
const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const readJson = async <T>(path: string): Promise<T> => JSON.parse(await readFile(new URL(path, root), 'utf8')) as T;
const report = (): Promise<CpuReport> => readJson('evidence/framescaper-corridorkey-production-cpu-candidate.json');

async function assertFilePin(pin: FilePin): Promise<void> {
	assert.ok(pin.path.length > 0 && !pin.path.startsWith('/') && !pin.path.split('/').includes('..'));
	const bytes = await readFile(new URL(pin.path, root));
	assert.equal(pin.byteLength, bytes.length, pin.path);
	assert.equal(pin.sha256, digest(bytes), pin.path);
}

test('retained production CPU evidence binds the exact candidate graphs without asserting GPU or publication readiness', async () => {
	const measured = await report();
	assert.equal(measured.schemaVersion, 1);
	assert.equal(measured.status, 'local-production-engine-cpu-parity-passed');
	assert.equal(measured.publicationReady, false);
	assert.equal(measured.gpuValidated, false);
	assert.equal(measured.modelId, 'corridorkey-2.0');
	assert.deepEqual(measured.environment, { target: 'linux-x64', node: 'v26.5.0', runtimeVersion: '1.29.0' });
	assert.deepEqual(measured.graphs, CORRIDORKEY_GRAPH_ARTIFACTS_V1);
	const conversion = await readJson<{ readonly graphs: readonly { readonly role: string; readonly artifacts: readonly {
		readonly fileName: string; readonly byteLength: number; readonly sha256: string }[] }[] }>(measured.provenance.conversionReport.path);
	assert.deepEqual(measured.graphs, conversion.graphs.map(graph => ({ role: graph.role, ...graph.artifacts[0] })));
	assert.deepEqual(measured.sessions, measured.graphs.map(graph => ({ fileName: graph.fileName, providers: ['cpu'] })));
});

test('CPU evidence authenticates the retained runtime snapshot and exact production processor/reference source bytes', async () => {
	const measured = await report();
	for (const pin of [measured.runtime.snapshot, measured.provenance.conversionReport, measured.provenance.sourceRegister,
		measured.provenance.toolchainLock, ...measured.provenance.processorSources, ...measured.provenance.runnerSources]) {
		await assertFilePin(pin);
	}
	assert.ok(measured.provenance.processorSources.some(pin => pin.path === 'desktop/assistance-corridorkey-inference.ts'));
	assert.ok(measured.provenance.processorSources.some(pin => pin.path === 'src/common/editor/assistance/corridorkey-pixels-v1.ts'));
	assert.ok(measured.provenance.runnerSources.some(pin => pin.path === 'scripts/models/corridorkey-production-cpu-reference.py'));
	const lock = await readJson<{ readonly targets: Readonly<Record<string, {
		readonly sourceRevision: string; readonly byteLength: number; readonly sha256: string }>> }>('config/desktop-test-assistance-runtime-snapshots.json');
	assert.deepEqual(measured.runtime.snapshot, { path: 'config/desktop-test-assistance-runtime-snapshots/linux-x64.json.gz', ...lock.targets['linux-x64'] });
	const snapshot = JSON.parse(gunzipSync(await readFile(new URL(measured.runtime.snapshot.path, root))).toString('utf8')) as {
		readonly sourceRevision: string; readonly files: Readonly<Record<string, string>> };
	const distribution = validateAssistanceRuntimeDistribution(JSON.parse(snapshot.files['config/assistance-runtime-distribution.json']!), 'linux-x64');
	const bundle = distribution.bundles.find(row => row.familyId === 'onnxruntime-node');
	assert.ok(bundle);
	assert.equal(measured.runtime.provider, 'cpu');
	assert.equal(measured.runtime.snapshot.sourceRevision, snapshot.sourceRevision);
	assert.deepEqual(measured.runtime.archive, bundle.archive);
	assert.equal(measured.runtime.fileCount, bundle.files.length);
});

test('measured source reference records two recurrent frames with soft alpha and at most one RGBA byte of error', async () => {
	const measured = await report();
	const source = await readJson<{ readonly source: { readonly revision: string } }>(measured.provenance.sourceRegister.path);
	assert.equal(measured.reference.sourceRevision, source.source.revision);
	assert.equal(measured.reference.trackedSourceFiles, 68);
	assert.deepEqual(measured.reference.fixture, { name: 'moving-ellipse-green-screen-rgba8-v1', width: 256, height: 256,
		frameCount: 2, referenceRgbaSha256: measured.reference.fixture.referenceRgbaSha256 });
	assert.match(measured.reference.fixture.referenceRgbaSha256, /^[a-f\d]{64}$/u);
	assert.deepEqual(measured.frames.map(frame => frame.ordinal), [0, 1]);
	for (const frame of measured.frames) {
		assert.equal(frame.inputRgbaSha256, digest(createCorridorKeyCpuDiagnosticFrameV1(frame.ordinal)));
		for (const hash of [frame.inputRgbaSha256, frame.referenceRgbaSha256, frame.nativeRgbaSha256]) assert.match(hash, /^[a-f\d]{64}$/u);
		assert.ok(frame.maximumRgbaError >= 0 && frame.maximumRgbaError <= 1);
		assert.ok(frame.transparent > 0 && frame.partial > 0 && frame.opaque > 0);
		assert.equal(frame.transparent + frame.partial + frame.opaque, 256 * 256);
	}
	assert.notEqual(measured.frames[0]!.inputRgbaSha256, measured.frames[1]!.inputRgbaSha256);
	assert.notEqual(measured.frames[0]!.referenceRgbaSha256, measured.frames[1]!.referenceRgbaSha256);
	assert.equal(measured.invocation.slice(0, 4).join(' '), 'node --import tsx scripts/models/validate-corridorkey-production-cpu-candidate.ts');
	for (const flag of ['--runtime-root', '--model-root', '--source-root', '--python', '--output']) assert.ok(measured.invocation.includes(flag));
	assert.throws(() => createCorridorKeyCpuDiagnosticFrameV1(2), /exactly two/iu);
});
