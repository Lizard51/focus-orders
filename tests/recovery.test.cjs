const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {Store}=require('../src/store.cjs');const seed=require('../src/seed.json');
test('Missing primary data recovers existing committed backups instead of silently starting empty',async t=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'focus-missing-'));t.after(()=>fs.rm(directory,{force:true,recursive:true}));
 const store=await Store.open({directory,seed});await store.command('createOrder',{number:'77',name:'Сохранённый заказ',templateId:store.snapshot().templates[0].id});
 const before=store.snapshot();await fs.unlink(path.join(directory,'state.json'));
 const recovered=await Store.open({directory,seed});assert.deepEqual(recovered.snapshot(),before);assert.ok(recovered.warnings.length>0);
});
