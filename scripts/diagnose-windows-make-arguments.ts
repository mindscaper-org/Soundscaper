/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('This probe requires a native Windows host.');
const found = spawnSync('where.exe', ['make.exe'], { encoding: 'utf8' });
if (found.status !== 0) throw new Error(found.stderr);
const make = realpathSync(found.stdout.trim().split(/\r?\n/u)[0]!);
const gitRoot = join(process.env.ProgramFiles ?? 'C:/Program Files', 'Git');
const shells = [join(gitRoot, 'bin/bash.exe'), join(gitRoot, 'usr/bin/bash.exe'), join(gitRoot, 'usr/bin/sh.exe')];
const directory = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'scape-make-args-'));
const forward = (value: string): string => value.replaceAll('\\', '/');
const quote = (value: string): string => `'${forward(value).replaceAll("'", "'\\''")}'`;
const script = join(directory, 'capture.sh');
writeFileSync(script, '#!/bin/bash\nset -euo pipefail\nresult=$1\nshift\n{ printf "%s\\n" "$#"; printf "%s\\0" "$@" | sha256sum; } > "$result"\n');
const args = Array.from({ length: 1000 }, (_, index) => `argument-${String(index).padStart(4, '0')}-xxxxxxxx`);
const expectedHash = createHash('sha256').update(args.map(value => `${value}\0`).join('')).digest('hex');
const results = [];
for (const [index, shell] of shells.entries()) {
	if (!existsSync(shell)) continue;
	for (const explicit of [false, true]) {
		const resultPath = join(directory, `result-${String(index)}-${String(explicit)}.txt`);
		const makefile = join(directory, `probe-${String(index)}-${String(explicit)}.mk`);
		const invocation = `${explicit ? `${quote(shell)} ` : ''}${quote(script)} ${quote(resultPath)} ${args.join(' ')}`;
		writeFileSync(makefile, `all:\n\t@${invocation}\n`);
		const run = spawnSync(make, ['-f', makefile, `SHELL=${forward(shell)}`, '.SHELLFLAGS=-e -c'], {
			cwd: directory, encoding: 'utf8', windowsHide: true,
			env: { ...process.env, PATH: `${dirname(shell)};${process.env.PATH ?? ''}` },
		});
		const output = existsSync(resultPath) ? readFileSync(resultPath, 'utf8').trim().split(/\s+/u) : [];
		const count = Number(output[0] ?? 0);
		const hash = output[1] ?? '';
		const passed = run.status === 0 && count === args.length && hash === expectedHash;
		results.push({ shell, explicit, status: run.status, count, hash, passed,
			stderr: run.stderr.slice(-1000), error: run.error?.message ?? null });
		console.log(JSON.stringify({ shell, explicit, count, passed }));
	}
}
const responseShell = shells.find(shell => existsSync(shell));
if (responseShell) {
	const resultPath = join(directory, 'response-result.txt');
	const wrapper = join(directory, 'response.sh');
	writeFileSync(wrapper, `#!/bin/bash\nset -euo pipefail\nread -r -a arguments < "$2"\nsource ${quote(script)} "$1" "\${arguments[@]}"\n`);
	const makefile = join(directory, 'response.mk');
	writeFileSync(makefile, `all:\n\t$(file >full-args.rsp,${args.join(' ')})\n\t@${quote(responseShell)} ${quote(wrapper)} ${quote(resultPath)} full-args.rsp\n`);
	const run = spawnSync(make, ['-f', makefile, `SHELL=${forward(responseShell)}`, '.SHELLFLAGS=-e -c'], {
		cwd: directory, encoding: 'utf8', windowsHide: true,
		env: { ...process.env, PATH: `${dirname(responseShell)};${process.env.PATH ?? ''}` },
	});
	const output = existsSync(resultPath) ? readFileSync(resultPath, 'utf8').trim().split(/\s+/u) : [];
	const count = Number(output[0] ?? 0), hash = output[1] ?? '';
	const passed = run.status === 0 && count === args.length && hash === expectedHash;
	results.push({ shell: responseShell, explicit: true, responseFile: true, status: run.status, count, hash, passed,
		stderr: run.stderr.slice(-1000), error: run.error?.message ?? null });
	console.log(JSON.stringify({ responseFile: true, count, passed }));
}
writeFileSync('windows-make-argument-probe.json', `${JSON.stringify({ make, expectedCount: args.length, expectedHash, results }, null, 2)}\n`);
if (!results.some(result => result.passed)) process.exitCode = 1;
