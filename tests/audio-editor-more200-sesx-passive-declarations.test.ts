/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import type { NativeProjectFileService } from '../src/common/editor/controller/document/native-project-types.ts';
import { registerDesktopReadCapability } from '../src/common/editor/desktop-read-capability-registry.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const [name, doctype, comment] of [
	['Manual <!DOCTYPE sesx> example', '', ''],
	['Manual <!DOCTYPE sesx> example', '<!DOCTYPE sesx>', ''],
	['Manual <!ENTITY take> example', '<!DOCTYPE sesx>', ''],
	['Voice', '<!DOCTYPE sesx>', '<!-- Provenance: <!DOCTYPE sesx> -->'],
	['Ordinary CDATA name', '<!DOCTYPE sesx>', '<!-- ordinary provenance -->'],
] as const) test(`native SESX File Open retains passive XML data ${JSON.stringify({ name, doctype, comment })}`, async () => {
	const xml = `${comment}${doctype}<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks>
		<audioTrack><trackParameters><name><![CDATA[${name}]]></name></trackParameters></audioTrack>
		</tracks></session></sesx>`;
	const file = new File([xml], 'Manual.sesx', { type: 'application/xml' });
	const sessionId = 'a'.repeat(64); registerDesktopReadCapability(file, sessionId);
	const fixture = createFixture({ adaptAudacityProject: importSoundscaperAudacityProject }); let released = 0;
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		withReadDescriptors: () => { throw new Error('The empty track needs no media reads.'); },
		resolveSesxMedia: () => { throw new Error('The empty track needs no media resolution.'); },
		chooseSesxMediaFolder: () => { throw new Error('The empty track needs no media folder.'); },
		releaseSesxSession: (id: string) => { assert.equal(id, sessionId); released += 1; return Promise.resolve(true); },
	} satisfies NativeProjectFileService;
	const opened = await createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file);
	assert.ok(opened); assert.ok(validateSoundscaperProject(opened.project));
	assert.equal(opened.project.tracks[0]?.name, name);
	assert.deepEqual(fixture.switched, [opened.project.id]); assert.equal(released, 1);
});

for (const doctype of ['<!DOCTYPE sesx SYSTEM "file:///private/session.dtd">', '<!DOCTYPE sesx [<!ENTITY take "text">]>',
	'<!DOCTYPE other>', '<!DOCTYPE sesx [<!ELEMENT sesx ANY>]>']) test(`SESX still refuses active declaration ${doctype}`, async () => {
	const file = new File([`${doctype}<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks/></session></sesx>`], 'Unsafe.sesx');
	registerDesktopReadCapability(file, 'a'.repeat(64)); const fixture = createFixture();
	const fileService = { ...fixture.runtime.fileService, isDesktop: true,
		withReadDescriptors: () => { throw new Error('Refused XML must not read media.'); },
		releaseSesxSession: () => Promise.resolve(true),
		resolveSesxMedia: () => { throw new Error('Refused XML must not resolve media.'); },
		chooseSesxMediaFolder: () => { throw new Error('Refused XML must not choose media.'); },
	} satisfies NativeProjectFileService;
	await assert.rejects(createNativeProjectService({ ...fixture.runtime, fileService }).openSesx(file), /doctype|entity|declaration/iu);
	assert.deepEqual(fixture.switched, []);
});
