/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {join} from 'node:path';
import {readLightscaperManagedSmokeOptionsCurrentV1 as options} from '../scripts/lib/lightscaper-desktop-managed-smoke-options-current-v1.ts';
import {validateLightscaperManagedSmokePlanCurrentV1 as readPlan} from '../desktop/lightscaper-managed-smoke-main-current-v1.ts';
const NONCE='0123456789abcdef0123456789abcdef',ROOT=join(process.cwd(),'owned-linked-smoke'),BASE=['--executable',join(ROOT,'Lightscaper'),'--runtime-root',join(ROOT,'runtime'),'--output-root',join(ROOT,'out')];
void test('Managed packaged smoke selects explicit finite scenario and linked requires native without enabling another authority',()=>{
 assert.equal(options(BASE,'linux').scenario,'managed');assert.equal(options([...BASE,'--scenario','linked','--backend','native'],'linux').scenario,'linked');
 for(const extra of [['--scenario','unknown'],['--scenario','linked'],['--scenario','linked','--backend','web'],['--scenario','linked','--scenario','linked']])assert.throws(()=>options([...BASE,...extra],'linux'));
});
void test('Linked packaged stage2 accepts no archive and never accepts a renderer root/path or Web backend',()=>{
 const stage=2 as const,value={schemaVersion:1,nonce:NONCE,stage,profilePath:join(ROOT,'profile'),renderer:{nonce:NONCE,stage,locale:'en',backend:'native',scenario:'linked',fixtures:[{name:'Owned raster.png',mimeType:'image/png',base64:'AQID',byteLength:3,sha256:'a'.repeat(64)},{name:'Owned Bayer.dng',mimeType:'image/x-adobe-dng',base64:'BAUG',byteLength:3,sha256:'b'.repeat(64)}],archive:null,expectedFingerprint:'d'.repeat(64),expectedNamespace:null,expectedPhotoIds:['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002'],backupSuggestedName:'Photo library.liscape'}},authority={planPath:join(ROOT,`${NONCE}.stage-${stage}.json`),profilePath:value.profilePath,nonce:NONCE};
 assert.deepEqual(readPlan(value,authority),value);for(const renderer of [{...value.renderer,backend:'web'},{...value.renderer,linkedRoot:ROOT},{...value.renderer,scenario:'arbitrary'},{...value.renderer,archive:{name:'Photo library.liscape',mimeType:'application/vnd.soundscaper.scape+zip',base64:'AQID',byteLength:3,sha256:'c'.repeat(64)}}])assert.throws(()=>readPlan({...value,renderer},authority));
});
