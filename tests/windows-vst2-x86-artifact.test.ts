/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import test from 'node:test';
import { inspectSoundscaperProfessionalNativeDependencies,
	validateSoundscaperProfessionalNativeDependencyClosure } from '../scripts/lib/soundscaper-professional-native-dependency-inspection.mjs';
import { WINDOWS_VST2_X86_ARTIFACT, validateProfessionalArtifactArchitecture } from '../scripts/lib/windows-vst2-x86-artifact.mjs';

test('PE32 dependency inspection is admitted only for the exact Windows x64 bridge role', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'vst2-x86-artifact-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const bytes = Buffer.alloc(1024); bytes.write('MZ'); bytes.writeUInt32LE(128, 0x3c);
	bytes.write('PE\0\0', 128, 'binary'); bytes.writeUInt16LE(0x14c, 132);
	bytes.writeUInt16LE(1, 134); bytes.writeUInt16LE(224, 148); bytes.writeUInt16LE(0x10b, 152);
	bytes.writeUInt32LE(512, 212); bytes.writeUInt32LE(16, 244);
	const path = join(root, WINDOWS_VST2_X86_ARTIFACT);
	await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes);
	const inspected = await inspectSoundscaperProfessionalNativeDependencies({ target: 'win-x64', path });
	assert.equal(inspected.architecture.architecture, 'ia32'); assert.deepEqual(inspected.imports, []);
	validateProfessionalArtifactArchitecture(inspected.architecture, 'win-x64', WINDOWS_VST2_X86_ARTIFACT);
	for (const forbidden of ['payload/soundscaper_professional.node', 'payload/soundscaper_professional_peer.exe',
		'payload/runtime/arbitrary.exe', 'payload/runtime/other/soundscaper_vst2_x86_peer.exe']) {
		assert.throws(() => validateProfessionalArtifactArchitecture(inspected.architecture, 'win-x64', forbidden));
	}
	assert.throws(() => validateProfessionalArtifactArchitecture(inspected.architecture, 'win-arm64', WINDOWS_VST2_X86_ARTIFACT));
	const primary = join(root, 'payload/soundscaper_professional_peer.exe'); await writeFile(primary, bytes);
	await assert.rejects(inspectSoundscaperProfessionalNativeDependencies({ target: 'win-x64', path: primary }), /PE32\+/u);
	const artifact = { path: WINDOWS_VST2_X86_ARTIFACT, absolutePath: path };
	await validateSoundscaperProfessionalNativeDependencyClosure({ target: 'win-x64', root,
		artifacts: [artifact], runtimeArtifacts: [artifact], inspectDependencies: async () => ({ ...inspected, imports: ['KERNEL32.dll'] }) });
	await assert.rejects(validateSoundscaperProfessionalNativeDependencyClosure({ target: 'win-x64', root,
		artifacts: [artifact], runtimeArtifacts: [artifact], inspectDependencies: async () => ({ ...inspected, imports: ['vendor.dll'] }) }), /only Windows system/u);
});
