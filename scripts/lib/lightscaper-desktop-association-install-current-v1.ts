/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir, lstat, realpath, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { associationToolCurrentV1 as tool, associationFileCurrentV1 as file, associationMissingCurrentV1 as missing, associationRecordCurrentV1 as record, associationReadCurrentV1 as read } from './lightscaper-desktop-association-evidence-current-v1.ts';
import type { LightscaperAssociationProcessOwnerCurrentV1 } from './lightscaper-desktop-association-evidence-current-v1.ts';
import type { LightscaperDesktopNativeCiTargetCurrentV1 } from './lightscaper-desktop-native-ci-plan-current-v1.ts';

/** Real native installers are permitted only on the explicitly ephemeral
 * hosted CI account. Local qualification can compile helpers/refusal tests;
 * it must not silently install/register a package into a developer's OS. */
export async function createLightscaperAssociationInstallerCurrentV1(options: Readonly<{
	target: LightscaperDesktopNativeCiTargetCurrentV1; artifactPath: string; workRoot: string;
	processOwner: LightscaperAssociationProcessOwnerCurrentV1; registryScriptPath?: string; registryRetireScriptPath?: string;
}>) {
	if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') throw new Error('Actual association installers require an explicitly ephemeral GitHub-hosted OS account.');
	if (options.target.platform === 'win' && /[\s"]/u.test(join(options.workRoot, 'installed'))) throw new TypeError('NSIS destination must not contain whitespace or quotes.');
	const run = options.processOwner.run, artifact = await file(options.artifactPath, 1024 ** 3), facts: unknown[] = [];
	const platform = options.target.platform;
	let installed = false, mountAttached = false;
	const mount = join(options.workRoot, 'dmg-mount'), destination = join(options.workRoot, 'installed');
	const bundlePath = platform === 'mac' ? join(destination, 'Lightscaper.app') : undefined;
	const executablePath = platform === 'mac' ? join(destination, 'Lightscaper.app/Contents/MacOS/Lightscaper')
		: platform === 'win' ? join(destination, 'Lightscaper.exe') : '/opt/Lightscaper/lightscaper';
	let windowsBefore: ReturnType<typeof readLightscaperAssociationRegistrySnapshotCurrentV1> | undefined;
	const registry = async () => {
		if (!options.registryScriptPath) throw new Error('The fixed read-only association registry source is required.');
		const script = await file(options.registryScriptPath, 65536);
		const process = await run(await tool('powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script.path], { deadlineMs: 60_000 });
		const snapshot = readLightscaperAssociationRegistrySnapshotCurrentV1(JSON.parse(process.stdout) as unknown);
		return { script, process, snapshot };
	};
	let nsisOperations = 0;
	const nsis = async (path: string, args: readonly string[]): Promise<unknown> => {
		// NSIS ships an x86-unicode stub even for a native ARM64 payload. Keep
		// the native Job guard unchanged: supervise a native Node owner instead.
		const admitted = await file(path, 1024 ** 3), name = `nsis-${++nsisOperations}`;
		const planPath = join(options.workRoot, `${name}.plan.json`), resultPath = join(options.workRoot, `${name}.result.json`), wrapper = join(options.workRoot, `${name}.cjs`);
		await writeFile(planPath, JSON.stringify({ executable: admitted, args, resultPath }), { flag: 'wx', mode: 0o600 });
		await writeFile(wrapper, NSIS_OWNER, { flag: 'wx', mode: 0o600 });
		const supervision = await run(process.execPath, [wrapper, planPath], { deadlineMs: 210_000 });
		const child = record(JSON.parse((await read(resultPath, 65536)).toString('utf8')) as unknown,
			['schemaVersion', 'executable', 'args', 'peMachine', 'optionalHeaderMagic', 'processId', 'exitCode', 'signal', 'closed']);
		if (child.schemaVersion !== 1 || JSON.stringify(child.executable) !== JSON.stringify(admitted) || JSON.stringify(child.args) !== JSON.stringify(args)
			|| child.peMachine !== 0x14c || child.optionalHeaderMagic !== 0x10b || typeof child.processId !== 'number' || child.processId < 1
			|| child.exitCode !== 0 || child.signal !== null || child.closed !== true) throw new Error('Actual SHA-admitted NSIS child did not naturally close under its native Job owner.');
		return { admitted, process: supervision, child };
	};
	const install = async (): Promise<unknown> => {
	if (installed || mountAttached) throw new Error('The actual native installer was already attempted.');
	if (platform === 'linux') {
		const dpkg = await tool('dpkg-query'), before = await run(dpkg, ['--show', '--showformat=${db:Status-Status}', 'lightscaper-desktop'], { deadlineMs: 15_000, acceptedExitCodes: [0, 1] });
		if (before.exitCode !== 1) throw new Error('A preexisting Lightscaper Debian package cannot be adopted or replaced.');
		await absent(executablePath); await absent('/usr/share/applications/org.lightscaper.desktop');
		const metadata = await run(await tool('dpkg-deb'), ['--field', artifact.path, 'Package', 'Architecture'], { deadlineMs: 15_000 });
		const fields = metadata.stdout.trim().split('\n');
		if (!fields.includes('Package: lightscaper-desktop') || !fields.includes(`Architecture: ${options.target.arch === 'x64' ? 'amd64' : 'arm64'}`) || fields.length !== 2) throw new Error('Actual Debian package identity/architecture differs from its target.');
		facts.push({ kind: 'actual-debian-native-installer', before, metadata });
		// A failed installer may have partially admitted this previously absent
		// package. Keep its actual state for the exact remove attempt below.
		installed = true;
		await run(await tool('sudo'), ['-n', await tool('dpkg'), '--install', artifact.path], { deadlineMs: 120_000 });
	} else if (platform === 'mac') {
		await mkdir(destination, { mode: 0o700 }); await mkdir(mount, { mode: 0o700 });
		const hdiutil = await tool('hdiutil');
		mountAttached = true;
		await run(hdiutil, ['attach', '-nobrowse', '-readonly', '-mountpoint', mount, artifact.path], { deadlineMs: 60_000 });
		try {
			installed = true;
			await run(await tool('ditto'), [join(mount, 'Lightscaper.app'), join(destination, 'Lightscaper.app')], { deadlineMs: 60_000 });
		} finally { await run(hdiutil, ['detach', mount], { deadlineMs: 30_000 }); mountAttached = false; }
		facts.push({ kind: 'actual-mounted-dmg-owned-bundle-install', mountPath: mount, bundlePath, mountDetached: true });
	} else {
		const before = await registry(); windowsBefore = before.snapshot;
		if ([windowsBefore.keys[0], windowsBefore.keys[1], windowsBefore.keys[8]].some(row => row?.state !== 'absent')) throw new Error('A preexisting per-user catalog association cannot be replaced.');
		await absent(destination); installed = true;
		facts.push({ nsisProcess: await nsis(artifact.path, ['/S', `/D=${destination}`]) });
		facts.push({ kind: 'actual-per-user-nsis-native-installer', before });
	}
	if (await realpath(executablePath) !== executablePath || !(await lstat(executablePath)).isFile()) throw new Error('Actual installed native executable is missing or aliased.');
	return Object.freeze({ artifact, facts: [...facts], executable: await file(executablePath, 1024 ** 3) });
	};
	return Object.freeze({ executablePath, bundlePath, artifact, install,
		resourcesRoot: platform === 'mac' ? join(dirname(dirname(executablePath)), 'Resources') : join(dirname(executablePath), 'resources'),
		async uninstall(readersRetired: boolean): Promise<unknown> {
			if (!readersRetired || !options.processOwner.readersRetired) throw new Error('Actual installed-app/installer consumers have not retired; retain installation.');
			if (mountAttached) { await run(await tool('hdiutil'), ['detach', mount], { deadlineMs: 30_000 }); mountAttached = false; }
			if (!installed) return { installed: false, removed: false };
			if (platform === 'linux') {
				const removed = await run(await tool('sudo'), ['-n', await tool('dpkg'), '--remove', 'lightscaper-desktop'], { deadlineMs: 60_000 });
				await absent(executablePath); await absent('/usr/share/applications/org.lightscaper.desktop'); installed = false;
				return { kind: 'actual-debian-native-remove', process: removed, executableAbsent: true, desktopEntryAbsent: true };
			}
			if (platform === 'win') {
				const uninstaller = join(destination, 'Uninstall Lightscaper.exe');
				await file(uninstaller, 64 * 1024 ** 2);
				const removed = await nsis(uninstaller, ['/S', `_?=${destination}`]);
				await absent(executablePath); const postUninstall = await registry();
				if (!windowsBefore || JSON.stringify(postUninstall.snapshot.keys.slice(2, 8)) !== JSON.stringify(windowsBefore.keys.slice(2, 8))
					|| postUninstall.snapshot.keys[1]?.state !== 'absent' || postUninstall.snapshot.keys[8]?.state !== 'absent') throw new Error('Native uninstall changed foreign associations or left owned class/UserChoice authority; no residue cleanup is authorized.');
				if (!options.registryRetireScriptPath) throw new Error('The fixed exact-residue retirement source is required.');
				const retireSource = await file(options.registryRetireScriptPath, 65536);
				const retireProcess = await run(await tool('powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', retireSource.path], { deadlineMs: 60_000 });
				const after = await registry();
				if (JSON.stringify(after.snapshot) !== JSON.stringify(windowsBefore)) throw new Error('Actual per-user native uninstall did not restore the captured association registry state.');
				installed = false; return { kind: 'actual-per-user-nsis-native-remove', process: removed, postUninstall, ownResidueRetirement: { source: retireSource, process: retireProcess }, after, registryRestored: true, executableAbsent: true };
			}
			// The real Mac unregister helper must already have retired the owned
			// Launch Services claim. The caller owns removal of this private copy.
			installed = false; return { kind: 'owned-dmg-bundle-copy-retired', registrationRetirementRequired: true };
		},
	});
}
export async function selectLightscaperAssociationArtifactCurrentV1(root: string, platform: string): Promise<string> {
	const suffix = platform === 'linux' ? '.deb' : platform === 'mac' ? '.dmg' : '.exe';
	const entries = await readdir(root); if (entries.length > 256) throw new Error('Installer output inventory exceeds its finite bound.');
	const candidates = entries.filter(name => name.startsWith('Lightscaper-') && name.endsWith(suffix));
	if (candidates.length !== 1) throw new Error('Exactly one actual target-native installer artifact is required.');
	return join(root, candidates[0]!);
}
async function absent(path: string): Promise<void> {
	try { await lstat(path); } catch (error) { if (missing(error)) return; throw error; }
	throw new Error('Association qualification refuses preexisting or unremoved OS state: ' + path);
}

export function readLightscaperAssociationRegistrySnapshotCurrentV1(value: unknown) {
	const snapshot = record(value, ['schemaVersion', 'hive', 'view', 'keys']);
	if (snapshot.schemaVersion !== 1 || snapshot.hive !== 'HKEY_CURRENT_USER' || snapshot.view !== 'Registry64' || !Array.isArray(snapshot.keys) || snapshot.keys.length !== 9) throw new Error('Actual registry snapshot has another scope.');
	const paths = ['.liscape', '.sscape', '.fscape', '.scape'].flatMap(suffix => [`Software\\Classes\\${suffix}`, `Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts\\${suffix}\\UserChoice`]);
	paths.push('Software\\Classes\\Lightscaper Catalog');
	const keys = snapshot.keys.map((value: unknown, index: number) => {
		const row = record(value, ['path', 'state', 'tree']);
		if (row.path !== paths[index] || row.state !== 'absent' && row.state !== 'present' || (row.state === 'absent' ? row.tree !== null : !row.tree || typeof row.tree !== 'object')) throw new Error('Actual registry key evidence is incomplete.');
		return Object.freeze({ path: paths[index]!, state: row.state, tree: row.tree });
	});
	return Object.freeze({ schemaVersion: 1, hive: 'HKEY_CURRENT_USER', view: 'Registry64', keys });
}

const NSIS_OWNER = String.raw`'use strict';
const fs=require('node:fs/promises'), crypto=require('node:crypto'), cp=require('node:child_process'), syncFs=require('node:fs');
const began=process.hrtime.bigint();let stageCount=0;
function stage(event,fields={}){
 if(stageCount>=16)return;const ordinal=++stageCount;
 const bytes=Buffer.from(JSON.stringify({schemaVersion:1,kind:'lightscaper-nsis-owner-stage-current-v1',ordinal,stage:event,elapsedMs:Number((process.hrtime.bigint()-began)/1000000n),...fields})+'\n');
 if(bytes.length>1024)return;
 try{let offset=0;while(offset<bytes.length){const count=syncFs.writeSync(2,bytes,offset,bytes.length-offset);if(count<=0)break;offset+=count}}catch{}
}
stage('owner-entry');
async function main(){
 const plan=JSON.parse(await fs.readFile(process.argv[2],'utf8')), expected=plan.executable;
 if(!expected||typeof expected.path!=='string'||!Number.isSafeInteger(expected.byteLength)||!/^[a-f0-9]{64}$/.test(expected.sha256)||!Array.isArray(plan.args)||plan.args[0]!=='/S'||plan.args.length>2||(plan.args.length===2&&!plan.args[1].startsWith('/D=')&&!plan.args[1].startsWith('_?=')))throw Error('Invalid exact NSIS plan');
 stage('plan-validated',{argumentCount:plan.args.length});
 const before=await fs.lstat(expected.path); if(!before.isFile()||before.isSymbolicLink()||before.size!==expected.byteLength||await fs.realpath(expected.path)!==expected.path)throw Error('NSIS path/size changed');
 const input=await fs.open(expected.path,'r'); let machine,magic;
 try{
  const header=Buffer.alloc(Math.min(16384,before.size)); const read=await input.read(header,0,header.length,0); const pe=header.readUInt32LE(0x3c);
  if(read.bytesRead!==header.length||header.readUInt16LE(0)!==0x5a4d||pe<64||pe+26>header.length||header.readUInt32LE(pe)!==0x4550)throw Error('NSIS PE header invalid');
  machine=header.readUInt16LE(pe+4);magic=header.readUInt16LE(pe+24);
  if(machine!==0x14c||magic!==0x10b||(header.readUInt16LE(pe+22)&0x2000)!==0)throw Error('Expected official x86 PE32 NSIS executable');
  const hash=crypto.createHash('sha256');let size=0;
  for await(const bytes of input.createReadStream({start:0,autoClose:false})){size+=bytes.length;if(size>expected.byteLength)throw Error('NSIS grew');hash.update(bytes)}
  const after=await input.stat(), atPath=await fs.lstat(expected.path);
  const actualSha256=hash.digest('hex');
  if(size!==expected.byteLength||actualSha256!==expected.sha256||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||atPath.dev!==before.dev||atPath.ino!==before.ino||atPath.isSymbolicLink())throw Error('NSIS bytes/identity changed');
  stage('admitted',{byteLength:size,sha256:actualSha256,peMachine:machine,optionalHeaderMagic:magic});
 }finally{await input.close()}
 const output=await fs.open(plan.resultPath,'wx',0o600);let failed=false,primary;
 try{
  const child=cp.spawn(expected.path,plan.args,{shell:false,windowsHide:true,windowsVerbatimArguments:false,stdio:['ignore','inherit','inherit']});
  child.once('spawn',()=>stage('spawn',{processId:child.pid??null}));
  child.once('exit',(exitCode,signal)=>stage('exit',{processId:child.pid??null,exitCode,signal}));
  const terminal=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(exitCode,signal)=>{stage('close',{processId:child.pid??null,exitCode,signal});resolve({exitCode,signal})})});
  await output.writeFile(JSON.stringify({schemaVersion:1,executable:expected,args:plan.args,peMachine:machine,optionalHeaderMagic:magic,processId:child.pid||0,exitCode:terminal.exitCode,signal:terminal.signal,closed:true}));await output.sync();
  if(terminal.exitCode!==0||terminal.signal!==null)throw Error('Actual NSIS child failed');
 }catch(error){failed=true;primary=error}
 let closeFailure;try{await output.close()}catch(error){closeFailure=error}
 if(closeFailure!==undefined){if(failed)throw new AggregateError([primary,closeFailure],'NSIS operation and result close failed',{cause:primary});throw closeFailure}
 if(failed)throw primary;
}
void main().catch(error=>{stage('failure');console.error(error);process.exitCode=1});
`;
