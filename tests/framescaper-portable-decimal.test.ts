/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

test('native plan decimal parsing preserves finite values without depending on the application locale', async context => {
	if (process.platform === 'win32') { context.skip('The target-native MSVC build compiles the same parser.'); return; }
	const directory = await mkdtemp(join(tmpdir(), 'framescaper-decimal-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const source = join(directory, 'fixture.cpp'), executable = join(directory, 'fixture');
	await writeFile(source, `#include "portable_decimal.hpp"
#include <limits>
class comma_punctuation : public std::numpunct<char> {
protected: char do_decimal_point() const override { return ','; }
};
int main() {
  std::locale::global(std::locale(std::locale::classic(), new comma_punctuation{}));
  for (const auto& [text, expected] : {
    std::pair{"0", 0.0}, {"-0.5", -0.5}, {".5", 0.5}, {"1e+2", 100.0},
    {"5e-324", std::numeric_limits<double>::denorm_min()}
  }) {
    double value{};
    if (!framescaper::media::try_read_finite_decimal(text, value) || value != expected) return 1;
  }
  for (const auto text : {"", "+0.5", " 0.5", "0.5 ", "0,5", "0x1p0", "nan", "inf", "1e309", "1e-9999", "0.5tail"}) {
    double value{};
    if (framescaper::media::try_read_finite_decimal(text, value)) return 2;
  }
}
`);
	const build = spawnSync(process.env.CXX ?? 'c++', ['-std=c++20', '-Wall', '-Wextra', '-Werror',
		'-I', resolve('native/framescaper-media-host/src'), source, '-o', executable], { encoding: 'utf8', timeout: 120_000 });
	if ((build.error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') { context.skip('A native C++ compiler is unavailable.'); return; }
	assert.equal(build.status, 0, build.stderr);
	const result = spawnSync(executable, [], { encoding: 'utf8', timeout: 10_000 });
	assert.equal(result.status, 0, result.stderr);
});
