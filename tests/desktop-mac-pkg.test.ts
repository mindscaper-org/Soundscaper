/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMacInstaller, macInstallerDistribution } from '../scripts/desktop-mac-pkg.mjs';
import afterAllArtifactBuild from '../scripts/desktop-after-all-artifact-build.mjs';

const LABEL = 'Add FFmpeg-support for proprietary file formats (M4A, MP4, MOV and more)';

test('PKG customization always shows a mandatory app and an initially unselected FFmpeg choice', () => {
	for (const productId of ['soundscaper', 'framescaper']) {
		const xml = macInstallerDistribution({ productId, version: '1.0.0-rc.Oct.30.a', minimumSystemVersion: '12.0' });
		assert.match(xml, /customize="always"/u);
		assert.match(xml, /hostArchitectures="arm64"/u);
		assert.match(xml, /<choice id="application"[^>]+enabled="false"[^>]+selected="true"/u);
		assert.match(xml, /<choice id="ffmpeg"[^>]+start_selected="false"/u);
		assert.equal(xml.includes(`title="${LABEL}"`), true);
		assert.equal(xml.includes('Homebrew will also be installed if it is missing'), true);
		assert.equal(xml.includes(`org.${productId}.desktop.ffmpeg.pkg`), true);
		assert.match(xml, /<os-version min="12\.0"\/>/u);
	}
});

test('PKG builds a separate no-payload FFmpeg component beside an exact app copy and signs the product', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-pkg-test-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const appPath = join(root, 'mac-arm64', 'Framescaper.app');
	await mkdir(appPath, { recursive: true });
	const calls: [string, readonly string[]][] = [];
	let postinstall = '';
	let distribution = '';
	let packageInfo = '';
	const artifact = await buildMacInstaller({
		appPath, outDir: root, productId: 'framescaper', version: '1.0.0-rc.Oct.30.a',
		installerIdentity: 'Developer ID Installer: Example (ABCDEFGHIJ)', keychain: '/tmp/signing.keychain',
	}, {
		executeFile: async (command: string, args: readonly string[]) => {
			calls.push([command, args]);
			if (command === '/usr/libexec/PlistBuddy') return { stdout: '12.0\n' };
			if (command === 'pkgbuild' && args.includes('--nopayload')) {
				const scripts = args[args.indexOf('--scripts') + 1]!;
				postinstall = await readFile(join(scripts, 'postinstall'), 'utf8');
			}
			if (command === 'pkgutil' && args[0] === '--expand') {
				await mkdir(args[2]!);
				await writeFile(join(args[2]!, 'PackageInfo'), '<pkg-info><scripts><postinstall file="./postinstall" timeout="600"/></scripts></pkg-info>');
			}
			if (command === 'pkgutil' && args[0] === '--flatten') {
				packageInfo = await readFile(join(args[1]!, 'PackageInfo'), 'utf8');
			}
			if (command === 'productbuild') {
				distribution = await readFile(args[args.indexOf('--distribution') + 1]!, 'utf8');
				await writeFile(args.at(-1)!, 'pkg fixture');
			}
			return { stdout: '' };
		},
	});
	assert.equal(artifact, join(root, 'Framescaper-1.0.0-rc.Oct.30.a-mac-arm64.pkg'));
	assert.deepEqual(calls.map(([command]) => command), ['/usr/libexec/PlistBuddy', 'ditto', 'pkgbuild', 'pkgbuild', 'pkgutil', 'pkgutil', 'productbuild']);
	const application = calls[2]![1];
	assert.equal(application.includes('--scripts'), false);
	assert.equal(application[application.indexOf('--compression') + 1], 'legacy');
	assert.equal(application[application.indexOf('--install-location') + 1], '/Applications');
	assert.equal(calls[3]![1].includes('--nopayload'), true);
	assert.match(postinstall, /PRODUCT_NAME='Framescaper'/u);
	assert.equal(postinstall.includes('@PRODUCT_NAME@'), false);
	assert.match(distribution, /start_selected="false"/u);
	assert.match(packageInfo, /timeout="7200"/u);
	assert.equal(calls.at(-1)![1].includes('Developer ID Installer: Example (ABCDEFGHIJ)'), true);
	assert.equal(calls.at(-1)![1].includes('/tmp/signing.keychain'), true);
});

test('PKG generation fails on a failed component and never publishes a partial installer', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-pkg-failure-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const appPath = join(root, 'Soundscaper.app');
	await mkdir(appPath);
	const calls: string[] = [];
	await assert.rejects(buildMacInstaller({ appPath, outDir: root, productId: 'soundscaper', version: '1.0.0' }, {
		executeFile: async (command: string) => {
			calls.push(command);
			if (command === 'pkgbuild') throw new Error('component failed');
			return { stdout: '12.0\n' };
		},
	}), /component failed/u);
	assert.equal(calls.includes('productbuild'), false);
});

test('after-all hook builds the PKG before verification and returns it as an additional artifact', async () => {
	const calls: string[] = [];
	const context = { outDir: '/release', artifactPaths: ['/release/Soundscaper-1.0.0-mac-arm64.dmg'] };
	const result = await afterAllArtifactBuild(context, {
		platform: 'darwin', env: {},
		buildInstaller: async (options: { appPath: string; productId: string; version: string }) => {
			assert.equal(options.appPath, '/release/mac-arm64/Soundscaper.app');
			assert.equal(options.productId, 'soundscaper');
			assert.equal(options.version, '1.0.0');
			calls.push('build');
			return '/release/Soundscaper-1.0.0-mac-arm64.pkg';
		},
		verifyArtifacts: async (value: typeof context) => {
			assert.equal(value.artifactPaths.includes('/release/Soundscaper-1.0.0-mac-arm64.pkg'), true);
			calls.push('verify');
			return [];
		},
	});
	assert.deepEqual(calls, ['build', 'verify']);
	assert.deepEqual(result, ['/release/Soundscaper-1.0.0-mac-arm64.pkg']);
});

test('non-Mac builds and directory-only Mac builds do not create an installer', async () => {
	for (const platform of ['linux', 'win32', 'darwin']) {
		const calls: string[] = [];
		await afterAllArtifactBuild({ outDir: '/release', artifactPaths: [] }, {
			platform, env: {},
			buildInstaller: async () => { throw new Error('unexpected installer'); },
			verifyArtifacts: async () => { calls.push('verify'); return []; },
		});
		assert.deepEqual(calls, ['verify']);
	}
});

test('the selected component installs through the non-root user and records consent only after both tools work', () => {
	const script = join(import.meta.dirname, '../desktop/installer/macos-ffmpeg-postinstall.sh');
	for (const failure of ['', 'brew', 'ffprobe']) {
		const result = spawnSync('/bin/bash', ['-c', `
source "$1"
install_user=tester
install_home='/Users/Test User'
PRODUCT_NAME=Soundscaper
ensure_homebrew() { printf 'ensure-homebrew\\n'; }
run_as_user() {
 printf 'user-command:%s\\n' "$*" >&2
 case "$*" in
  *'/brew install ffmpeg') if [[ "$2" == install && "$FAILURE" == brew ]]; then return 42; fi;;
  *'/ffprobe -version') if [[ "$FAILURE" == ffprobe ]]; then return 43; fi;;
 esac
}
install_ffmpeg
`, '--', script], { encoding: 'utf8', env: { ...process.env, FAILURE: failure } });
		assert.equal(result.status, failure === 'brew' ? 42 : failure === 'ffprobe' ? 43 : 0, result.stderr);
		assert.equal(result.stderr.includes('ffmpeg-installer-consent'), failure === '', result.stderr);
		assert.equal(result.stderr.includes('user-command:/opt/homebrew/bin/brew install ffmpeg'), true);
		if (failure === '') {
			assert.match(result.stderr, /user-command:\/usr\/bin\/tee \/Users\/Test User\/Library\/Application Support\/Soundscaper\/ffmpeg-installer-consent/u);
		}
	}
});

test('a Homebrew download with a wrong hash is never executed', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-brew-hash-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const prefix = join(root, 'homebrew');
	await mkdir(prefix);
	const workingDirectory = join(root, 'download');
	await mkdir(workingDirectory);
	const result = spawnSync('/bin/bash', ['-c', `
source "$1"
homebrew_prefix="$2"
install_user=tester
ensure_command_line_tools() { :; }
run_as_user() { printf 'user-command:%s\\n' "$*"; }
function /usr/bin/mktemp() { printf '%s\\n' "$DOWNLOAD"; }
function /bin/chmod() { :; }
function /usr/bin/curl() { printf 'download\\n'; }
function /usr/bin/shasum() { printf 'incorrect-hash  installer\\n'; }
ensure_homebrew
`, '--', join(import.meta.dirname, '../desktop/installer/macos-ffmpeg-postinstall.sh'), prefix], {
		encoding: 'utf8', env: { ...process.env, DOWNLOAD: workingDirectory },
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /failed its SHA-256 check/u);
	assert.equal(result.stdout.includes('user-command:/bin/bash'), false);
});

test('a missing Homebrew gets a user-owned prefix and verified user bootstrap, while an existing brew is reused', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-brew-bootstrap-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const workingDirectory = join(root, 'download');
	await mkdir(workingDirectory);
	const result = spawnSync('/bin/bash', ['-c', `
source "$1"
homebrew_prefix="$2"
install_user=tester
ensure_command_line_tools() { printf 'clt-ready\\n'; }
function /usr/bin/id() { printf 'staff\\n'; }
function /usr/bin/install() { printf 'provision:%s\\n' "$*"; /bin/mkdir "$PREFIX"; }
function /usr/bin/mktemp() { printf '%s\\n' "$DOWNLOAD"; }
function /usr/bin/curl() { printf 'download\\n'; printf 'fixture\\n' > "$DOWNLOAD/install.sh"; }
function /usr/bin/shasum() { printf '%s  installer\\n' "$HOMEBREW_INSTALL_SHA256"; }
run_as_user() {
 printf 'user-command:%s\\n' "$*"
 if [[ "$1" == /bin/bash ]]; then
  /bin/mkdir -p "$PREFIX/bin"
  printf '#!/bin/bash\\n' > "$PREFIX/bin/brew"
  /bin/chmod +x "$PREFIX/bin/brew"
 fi
}
ensure_homebrew
ensure_homebrew
`, '--', join(import.meta.dirname, '../desktop/installer/macos-ffmpeg-postinstall.sh'), join(root, 'homebrew')], {
		encoding: 'utf8', env: { ...process.env, DOWNLOAD: workingDirectory, PREFIX: join(root, 'homebrew') },
	});
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout.match(/^download$/gmu)?.length, 1);
	assert.match(result.stdout, /provision:-d -o tester -g staff -m 0755/u);
	assert.equal(result.stdout.match(/user-command:\/bin\/bash/gu)?.length, 1);
});
