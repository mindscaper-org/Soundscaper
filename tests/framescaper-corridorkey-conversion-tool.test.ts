/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CORRIDORKEY_GRAPH_ARTIFACTS_V1 } from '../desktop/assistance-corridorkey-model.ts';

const TOOL_ROOT = fileURLToPath(new URL('../scripts/models/corridorkey-conversion-tool/', import.meta.url));

interface ConversionEvidence {
	readonly publicationReady: boolean;
	readonly allFiveGraphsValidated: boolean;
	readonly registerSha256: string;
	readonly toolchainLockSha256: string;
	readonly conversionToolFiles: readonly { fileName: string; byteLength: number; sha256: string }[];
	readonly graphs: readonly {
		role: string; status: string; storage: string;
		artifacts: readonly { fileName: string; byteLength: number; sha256: string }[];
		cpuParity: readonly { height: number; width: number }[];
	}[];
}

function python(args: readonly string[]) {
	return spawnSync('python3', ['-B', ...args], {
		cwd: TOOL_ROOT, encoding: 'utf8',
		env: { ...process.env, PYTHONPATH: TOOL_ROOT, PYTHONDONTWRITEBYTECODE: '1' },
	});
}

test('CorridorKey source admission rejects altered bytes, extra Python and indirect paths without model frameworks', () => {
	const result = python(['-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_inputs.py']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stderr, /Ran 4 tests/u);
});

test('CorridorKey conversion exposes a local candidate CLI before loading model frameworks', () => {
	const result = python(['-m', 'framescaper_corridorkey_conversion', '--help']);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /never publishes models/u);
	assert.match(result.stdout, /--source-root/u);
	assert.doesNotMatch(result.stdout, /--publish|--download/u);
});

test('CorridorKey conversion locks the maintained framework versions', () => {
	const result = python(['-c', `
import json
from pathlib import Path
import tomllib

project = tomllib.loads(Path("pyproject.toml").read_text())
lock = tomllib.loads(Path("uv.lock").read_text())
names = ("torch", "torchvision", "onnx", "protobuf", "onnxscript")
direct = dict(value.split("==", 1) for value in project["project"]["dependencies"] if "==" in value)
expected = {name: direct[name] for name in names}
for package in lock["package"]:
    if package["name"] in names:
        assert package["version"].split("+", 1)[0] == expected[package["name"]]
print(json.dumps(expected, sort_keys=True))
`]);
	assert.equal(result.status, 0, result.stderr);
	const actual: unknown = JSON.parse(result.stdout);
	assert.deepEqual(actual, { onnx: '1.22.0', onnxscript: '0.7.2', protobuf: '5.29.6',
		torch: '2.13.0', torchvision: '0.28.0' });
});

test('retained real-weight CPU parity binds all five embedded graphs to the measured recipe and source pins', async () => {
	const report = JSON.parse(await readFile(new URL(
		'../evidence/framescaper-corridorkey-conversion-candidate.json', import.meta.url), 'utf8')) as ConversionEvidence;
	const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
	assert.equal(report.publicationReady, false, 'CPU parity does not establish GPU support or publication.');
	assert.equal(report.allFiveGraphsValidated, true);
	assert.deepEqual(report.graphs.map(({ role }) => role), ['cradio', 'moge', 'rvm', 'stage1', 'stage2']);
	assert.deepEqual(CORRIDORKEY_GRAPH_ARTIFACTS_V1, report.graphs.map((graph) => ({
		role: graph.role, ...graph.artifacts[0],
	})), 'Runtime graph admission must use the exact artifacts that passed real-weight conversion parity.');
	assert.equal(report.registerSha256, digest(await readFile(new URL(
		'../config/framescaper-corridorkey-model-source-candidate.json', import.meta.url))));
	assert.equal(report.toolchainLockSha256, digest(await readFile(`${TOOL_ROOT}/uv.lock`)));
	for (const file of report.conversionToolFiles) {
		const body = await readFile(`${TOOL_ROOT}/${file.fileName}`);
		assert.equal(body.byteLength, file.byteLength, file.fileName);
		assert.equal(digest(body), file.sha256, file.fileName);
	}
	for (const graph of report.graphs) {
		assert.equal(graph.status, 'candidate-cpu-parity-passed');
		assert.equal(graph.storage, 'embedded-single-blob');
		assert.equal(graph.artifacts.length, 1, 'Content-addressed installation cannot resolve ONNX sidecars.');
		assert.equal(graph.artifacts[0]?.fileName, `${graph.role}.onnx`);
		assert.ok(graph.artifacts[0]!.byteLength > 0 && graph.artifacts[0]!.byteLength < 2 ** 31);
		assert.match(graph.artifacts[0]!.sha256, /^[a-f\d]{64}$/u);
		assert.deepEqual(graph.cpuParity.map(({ height, width }) => [height, width]),
			[[256, 256], [256, 512], [512, 256]]);
	}
});
