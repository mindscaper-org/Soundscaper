/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

const repository = resolve(import.meta.dirname, '..');

function fixture(browser: boolean, toolingBrowser: boolean) {
	const root = mkdtempSync(join(tmpdir(), 'module-command-execution-'));
	const write = (file: string, content: string): void => {
		mkdirSync(dirname(join(root, file)), { recursive: true });
		writeFileSync(join(root, file), content);
	};
	for (const file of ['check-modules.ts', 'compact-v8-coverage.mjs', 'lib/check-module-repository.ts',
		'lib/check-module-coverage.ts', 'lib/module-policy.ts', 'lib/module-test-plan.ts', 'lib/module-test-suites.ts',
		'lib/module-dependency-graph.ts', 'lib/browser-product-site-plan.mjs', 'lib/product-aliases.mjs', 'lib/coverage-gates.mjs',
		'lib/coverage-function-normalization.mjs', 'lib/v8-coverage-compaction.mjs', 'lib/coverage-script-identity.mjs']) {
		mkdirSync(dirname(join(root, 'scripts', file)), { recursive: true });
		cpSync(join(repository, 'scripts', file), join(root, 'scripts', file));
	}
	write('package.json', '{"type":"module"}');
	write('.gitignore', 'node_modules/\ncoverage/\n.wrangler/\nactivity.log\n');
	write('.c8rc.json', JSON.stringify({ all: true, extension: ['.js'], include: ['src/**/*.js'], exclude: [] }));
	write('config/coverage-gates.json', readFileSync(join(repository, 'config/coverage-gates.json'), 'utf8'));
	const id = browser ? 'imaging' : 'tooling';
	write('config/module-policy.json', JSON.stringify({ schemaVersion: 1, modules: [{ id,
		sourcePrefixes: browser ? ['src/common/imaging/'] : ['scripts/'], nodeTests: ['tests/unit.test.js'],
		browserTests: browser || toolingBrowser ? ['tests/browser/preview.spec.js'] : [], products: ['framescaper'],
		...(browser ? { independent: true, coverageScope: 'editor' } : {}),
	}] }));
	write('src/common/imaging/output.js', 'export function nodePath() {\n return 1;\n}\nexport function browserPath() {\n return 2;\n}\n');
	write('tests/unit.test.js', "import { nodePath } from '../src/common/imaging/output.js'; nodePath();\n");
	if (browser || toolingBrowser) write('tests/browser/preview.spec.js', '');
	write('fake-npm.mjs', "import { appendFileSync } from 'node:fs'; appendFileSync('activity.log', 'static\\n');");
	const capture = `
import { appendFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const directory = process.argv.find(arg => arg.startsWith('--coverage-directory='))?.slice('--coverage-directory='.length) || 'coverage/v8-browser';
const browser = process.argv[1].endsWith('run-module-browser-tests.ts');
appendFileSync('activity.log', browser ? 'browser\\n' : 'node\\n');
if (browser && process.env.SCAPE_BROWSER_COVERAGE !== '1') process.exit(0);
mkdirSync(directory, { recursive: true });
const result = spawnSync(process.execPath, ['--input-type=module', '--eval',
 "const output = await import('./src/common/imaging/output.js'); output." + (browser ? 'browserPath' : 'nodePath') + '();'],
 { env: { ...process.env, NODE_V8_COVERAGE: directory }, stdio: 'inherit' });
process.exitCode = result.status ?? 1;
`;
	write('scripts/run-node-tests.mjs', capture);
	write('scripts/run-module-browser-tests.ts', capture);
	write('scripts/lib/browser-product-test-sites.mjs', `
import { appendFileSync } from 'node:fs';
export const ordinaryBrowserProductSitePlan = () => ({ sites: [{}] });
export async function buildBrowserProductSite() { appendFileSync('activity.log', 'build\\n'); }
`);
	symlinkSync(join(repository, 'node_modules'), join(root, 'node_modules'), 'junction');
	execFileSync('git', ['init', '--quiet', root]);
	execFileSync('git', ['-C', root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'Fixture']);
	return { root, id };
}

for (const [browser, toolingBrowser] of [[false, false], [true, false], [false, true]] as const) test(browser
	? 'module coverage waits for complementary browser execution before enforcing inherited floors'
	: `test-only module gates execute owner ${toolingBrowser ? 'Node and browser' : 'Node'} tests without inventing a production coverage cohort`, () => {
	const { root, id } = fixture(browser, toolingBrowser);
	try {
		const result = spawnSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/check-modules.ts'), `--module=${id}`], {
			cwd: root, encoding: 'utf8', timeout: 30_000, env: { ...process.env, npm_execpath: join(root, 'fake-npm.mjs') },
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
		const activity = readFileSync(join(root, 'activity.log'), 'utf8').trim().split('\n');
		assert.ok(activity.includes('node'));
		if (browser || toolingBrowser) {
			assert.ok(activity.indexOf('node') < activity.indexOf('build'));
			assert.ok(activity.indexOf('build') < activity.indexOf('browser'));
		} else assert.equal(activity.includes('browser'), false);
		if (browser) assert.match(result.stdout, /imaging\/editor: lines 100\.00%/u);
		else assert.equal(existsSync(join(root, 'coverage/modules/combined')), false);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
