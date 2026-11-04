/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const MODULE = resolve(import.meta.dirname,
	'../native/soundscaper-professional-host/cmake/fst-juce-compatibility.cmake');
// Minimal SDK declarations retain FST's pointer selection and flexible arrays.
const SOURCE = `/* Upstream notice must survive the build-copy transformation. */
#define FST_UNKNOWN(value) value
#if defined(_WIN32) && (defined(__x86_64__) || defined (_M_X64))
typedef long long t_fstPtrInt;
#else
typedef long t_fstPtrInt;
#endif
typedef t_fstPtrInt VstIntPtr;
struct t_fstEvent { int type, byteSize, deltaFrames, flags; };
struct t_fstSpeakerProperties { char bytes[112]; };
struct VstSpeakerArrangement {
  int type, numChannels;
  t_fstSpeakerProperties speakers[];
};
struct VstEvents {
  int numEvents;
  t_fstPtrInt reserved;
  t_fstEvent*events[];
};
struct MidiKeyName {
  int thisProgramIndex, thisKeyNumber;
  char keyName[];
};
typedef struct {
  char label[64];
  int flags, arrangementType;
  char shortLabel[8];
} FST_UNKNOWN(t_fstPinProperties);
`;
const PROBE = `#include "fst.h"
static_assert(sizeof(VstIntPtr) == sizeof(void *), "VST2 integers must preserve pointers");
static_assert(sizeof(VstSpeakerArrangement) >= 8 + 8 * sizeof(t_fstSpeakerProperties));
static_assert(sizeof(VstEvents) >= 4 * sizeof(void *));
static_assert(sizeof(MidiKeyName) >= 8 + 64);
static_assert(sizeof(t_fstPinProperties) == 128);
`;
const compiler = process.platform === 'linux'
	? ['clang++', ...Array.from({ length: 9 }, (_, index) => `clang++-${22 - index}`)]
		.find((candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0)
	: undefined;

test('the FST build copy preserves the VST2 ABI on all maintained targets', {
	skip: compiler === undefined && 'Requires Clang for target ABI syntax checks',
}, async (context) => {
	assert.ok(compiler);
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-fst-abi-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'upstream.h');
	const output = join(root, 'fst.h');
	const script = join(root, 'prepare.cmake');
	const probe = join(root, 'probe.cpp');
	await Promise.all([
		writeFile(input, SOURCE),
		writeFile(probe, PROBE),
		writeFile(script, `include("${MODULE}")\n`
			+ `soundscaper_write_fst_juce_header("${input}" "${output}")\n`),
	]);
	await execute('cmake', ['-P', script]);
	assert.equal(await readFile(input, 'utf8'), SOURCE);
	assert.ok((await readFile(output, 'utf8')).startsWith('/* Upstream notice must survive'));
	for (const target of [
		'x86_64-unknown-linux-gnu', 'aarch64-unknown-linux-gnu', 'arm64-apple-macos',
		'x86_64-pc-windows-msvc', 'aarch64-pc-windows-msvc',
	]) {
		await execute(compiler, [`--target=${target}`, '-std=c++20', '-fsyntax-only', probe]);
	}
});

test('the FST build copy rejects an unexpected pointer-width declaration', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-fst-abi-boundary-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const input = join(root, 'upstream.h');
	const output = join(root, 'fst.h');
	const script = join(root, 'prepare.cmake');
	await writeFile(script, `include("${MODULE}")\n`
		+ `soundscaper_write_fst_juce_header("${input}" "${output}")\n`);
	await writeFile(input, SOURCE.replace('defined (_M_X64)', 'defined (_M_DIFFERENT)'));
	await assert.rejects(execute('cmake', ['-P', script]), /unexpected pointer-width declaration/u);
	await assert.rejects(readFile(output), { code: 'ENOENT' });
});
