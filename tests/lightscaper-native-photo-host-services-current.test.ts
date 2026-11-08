/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { LightscaperNativePhotoHostServicesCurrentV1 as Host } from '../desktop/lightscaper-native-photo-host-services-current-v1.ts';
void test('Native host services keep absent optional protected Photo assets on the complete managed/Web path',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lightscaper host absent '));let calls=0;
 const owner=new Host({applicationRoot:directory,resourcesPath:directory,packaged:false,chooseLinkedRoot:async()=>{calls++;return null;}});
 try{assert.deepEqual(await owner.services(),{});assert.equal(calls,0);await owner.close();await assert.rejects(owner.services());}finally{await owner.close();await rm(directory,{recursive:true});}
});
void test('Native host services refuse a present malformed protected manifest rather than treating a missing pinned member as optional',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'lightscaper host corrupt '));await mkdir(join(directory,'config'));await writeFile(join(directory,'config/lightscaper-native-photo-payload-current-v1.json'),'{}\n');let calls=0;
 const owner=new Host({applicationRoot:directory,resourcesPath:directory,packaged:false,chooseLinkedRoot:async()=>{calls++;return null;}});
 try{await assert.rejects(owner.services());assert.equal(calls,0);}finally{await owner.close();await rm(directory,{recursive:true});}
});
