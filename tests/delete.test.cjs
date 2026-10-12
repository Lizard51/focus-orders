const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {Store}=require('../src/store.cjs');const seed=require('../src/seed.json');
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'focus-delete-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));const store=await Store.open({directory,seed});for(const number of ['101','102'])await store.command('createOrder',{number,name:'Заказ '+number,templateId:store.snapshot().templates[0].id});return {directory,store};}
for(const status of ['active','archived'])test('Deleting '+status+' order preserves other orders/templates, backup and restart',async t=>{
 const {store,directory}=await fixture(t);let order=store.snapshot().orders[0];await store.command('saveOrder',{id:order.id,expectedVersion:order.version,patch:{notes:'Сохранить перед удалением'}});if(status==='archived')await store.command('archiveOrder',{id:order.id});order=store.snapshot().orders[0];const before=store.snapshot();
 await store.command('deleteOrder',{id:order.id,expectedVersion:order.version});const after=store.snapshot();assert.deepEqual(after.orders,[before.orders[1]]);assert.deepEqual(after.templates,before.templates);
 assert.deepEqual((await Store.open({directory,seed})).snapshot(),after);const backups=await store.listBackups();let found=false;for(const b of backups){const state=await store.previewBackup(b.id);if(state.orders.some(o=>o.id===order.id&&o.notes==='Сохранить перед удалением'))found=true;}assert.equal(found,true);
});
test('Stale deletion and unknown identity cannot remove orders',async t=>{
 const {store}=await fixture(t);const order=store.snapshot().orders[0];await store.command('saveOrder',{id:order.id,expectedVersion:order.version,patch:{notes:'Новое'}});const before=store.export();
 await assert.rejects(store.command('deleteOrder',{id:order.id,expectedVersion:order.version}),/CONFLICT/);await assert.rejects(store.command('deleteOrder',{id:'missing',expectedVersion:1}),/NOT_FOUND/);assert.equal(store.export(),before);
});
test('Failed durable deletion keeps current memory and disk intact',async t=>{
 const {store,directory}=await fixture(t);const before=store.export();const failing=await Store.open({directory,seed,fsOps:{rename:async(from,to)=>{if(to===path.join(directory,'state.json'))throw Error('TEST_DELETE_FAILURE');return fs.rename(from,to);}}});const order=failing.snapshot().orders[0];
 await assert.rejects(failing.command('deleteOrder',{id:order.id,expectedVersion:order.version}),/TEST_DELETE_FAILURE/);assert.equal(failing.export(),before);assert.equal((await Store.open({directory,seed})).export(),before);
});
