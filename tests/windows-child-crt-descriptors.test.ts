/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
const execute = promisify(execFile);

test('Windows CRT startup descriptors use the child ABI independently of the launcher ABI', {
	skip: process.platform !== 'linux',
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'child-crt-abi-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const source = join(root, 'probe.cpp'), binary = join(root, 'probe');
	await writeFile(source, `#include "${resolve('native/milestone-5-native-isolation-launcher/src/windows_child_crt_descriptors.h')}"
#include <cassert>
int main() {
  const std::vector<uint64_t> handles{0x11223344, 0x55667788, 0x01020304};
  const std::vector<unsigned char> x86{3,0,0,0,9,9,9,0x44,0x33,0x22,0x11,0x88,0x77,0x66,0x55,4,3,2,1};
  assert(soundscaper::childCrtDescriptors(handles, 4) == x86);
  const auto x64 = soundscaper::childCrtDescriptors(handles, 8);
  assert(x64.size() == 31 && x64[11] == 0 && x64[15] == 0x88 && x64[23] == 4);
  assert(soundscaper::childCrtDescriptors({0x100000000ull}, 4).empty());
  assert(soundscaper::childCrtDescriptors(handles, 3).empty());
}
`);
	await execute('g++', ['-std=c++20', '-Wall', '-Wextra', '-Werror', source, '-o', binary]);
	const result = await execute(binary);
	assert.equal(result.stderr, '');
});
