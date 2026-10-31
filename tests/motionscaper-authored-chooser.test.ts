/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

test('Motionscaper authored chooser refuses foreign windows, layouts, paths and stale process owners before input', async () => {
	const modulePath = fileURLToPath(new URL('../scripts/lib/motionscaper_authored_chooser_policy.py', import.meta.url));
	const program = `import importlib.util,json,os,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('policy',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def refuses(fn):
 try: fn()
 except (ValueError,RuntimeError): return
 raise AssertionError('Unexpected admission')
with tempfile.TemporaryDirectory(prefix='motion-authored-') as directory:
 p=pathlib.Path(directory);owner={'pid':os.getpid(),'startTicks':pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]}
 (p/'chooser-owner.json').write_text(json.dumps({'owner':owner,'display':':987'}))
 env={'DISPLAY':':987','MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY':':987'}
 for mode,name in [('save-project','saved.mscape'),('export','output.mov'),('cancel-export','output.mov')]:
  result=m.validate_arguments([directory,mode,name],env);assert result['selected_path']==directory+'/'+name
 for args in [[],[directory,'other','output.mov'],[directory,'export','saved.mscape'],[directory+'/..','export','output.mov'],[directory,'export','../output.mov']]: refuses(lambda:m.validate_arguments(args,env))
 refuses(lambda:m.validate_arguments([directory,'export','output.mov'],dict(env,DISPLAY=':988')))
 owner['startTicks']='1';(p/'chooser-owner.json').write_text(json.dumps({'owner':owner,'display':':987'}));refuses(lambda:m.validate_arguments([directory,'export','output.mov'],env))
m.validate_window(10,10,3,3,3,1124,822,2)
for values in [(10,11,3,3,3,1124,822,2),(10,10,3,4,3,1124,822,2),(10,10,3,3,4,1124,822,2),(10,10,3,3,3,1125,822,2),(10,10,3,3,3,1124,822,0)]: refuses(lambda:m.validate_window(*values))
print('MOTION_AUTHORED_CHOOSER_NEGATIVE_CASES_PASSED')`;
	const result = await promisify(execFile)('python3', ['-B', '-E', '-s', '-c', program, modulePath], { env: { ...process.env, DISPLAY: '' }, timeout: 5000, maxBuffer: 65536 });
	assert.match(result.stdout, /MOTION_AUTHORED_CHOOSER_NEGATIVE_CASES_PASSED/u);
});

test('Portable GTK chooser binds each new Open/Save grant to its exact live owner file and private display', async () => {
	const modulePath = fileURLToPath(new URL('../scripts/lib/motionscaper_qualification_chooser_policy.py', import.meta.url));
	const program = `import importlib.util,json,os,pathlib,sys,tempfile
spec=importlib.util.spec_from_file_location('policy',sys.argv[1]);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def refuses(fn):
 try: fn()
 except (ValueError,RuntimeError): return
 raise AssertionError('Unexpected admission')
with tempfile.TemporaryDirectory(prefix='motion-portable-') as directory:
 p=pathlib.Path(directory);owner={'pid':os.getpid(),'startTicks':pathlib.Path('/proc/self/stat').read_text().rsplit(')',1)[1].split()[19]}
 record=p/('chooser-owner-'+str(owner['pid'])+'.json');record.write_text(json.dumps({'owner':owner,'display':':987'}))
 env={'DISPLAY':':987','MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY':':987'}
 for mode,name in [('save-project','saved.mscape'),('export','output.mov'),('cancel-export','output.mov'),('scene-export','output.mov'),('successor-export','output.mov')]:
  selected=m.validate_arguments([directory,mode,name,str(record)],env);assert selected['owner_pid']==owner['pid']
 (p/'saved.mscape').write_bytes(b'owned project')
 for mode in ['scene-open','successor-open']:
  selected=m.validate_arguments([directory,mode,'saved.mscape',str(record)],env);assert selected['selected_path']==str(p/'saved.mscape')
 refuses(lambda:m.validate_arguments([directory,'scene-open','output.mov',str(record)],env))
 refuses(lambda:m.validate_arguments([directory,'scene-export','output.mov',str(record)],{'DISPLAY':':987'}))
 foreign=p/'chooser-owner-1.json';foreign.write_text(record.read_text())
 refuses(lambda:m.validate_arguments([directory,'scene-export','output.mov',str(foreign)],env))
 owner['startTicks']='1';record.write_text(json.dumps({'owner':owner,'display':':987'}))
 refuses(lambda:m.validate_arguments([directory,'scene-export','output.mov',str(record)],env))
print('PORTABLE_CHOOSER_GRANTS_PASSED')`;
	const result = await promisify(execFile)('python3', ['-B', '-E', '-s', '-c', program, modulePath], { timeout: 5000, maxBuffer: 65536 });
	assert.match(result.stdout, /PORTABLE_CHOOSER_GRANTS_PASSED/u);
});
