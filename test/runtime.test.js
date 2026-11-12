import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRuntime,loadEnvironment} from '../src/runtime.js';

test('launcher rejects old Node with a useful error before starting the bot',()=>{
  for(const version of ['16.20.2','18.20.8','20.19.0','22.12.0'])assert.throws(()=>assertRuntime(version),/22.13/);
  for(const version of ['22.13.0','22.20.0','24.18.1'])assert.doesNotThrow(()=>assertRuntime(version));
});
test('environment loads from project root without replacing service environment',()=>{
  const root=mkdtempSync(join(tmpdir(),'barni-runtime-'));
  try {
    process.env.BARNI_RUNTIME_TEST_EXISTING='service';
    writeFileSync(join(root,'.env'),'BARNI_RUNTIME_TEST_EXISTING=file\nBARNI_RUNTIME_TEST_NEW="value with spaces"\n');
    loadEnvironment(root);
    assert.equal(process.env.BARNI_RUNTIME_TEST_EXISTING,'service');
    assert.equal(process.env.BARNI_RUNTIME_TEST_NEW,'value with spaces');
    assert.doesNotThrow(()=>loadEnvironment(join(root,'missing')));
  } finally {
    delete process.env.BARNI_RUNTIME_TEST_EXISTING;delete process.env.BARNI_RUNTIME_TEST_NEW;
    rmSync(root,{recursive:true,force:true});
  }
});
