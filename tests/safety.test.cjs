const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {Store} = require('../src/store.cjs');
const seed = require('../src/seed.json');
async function dir(t) { const directory = await fs.mkdtemp(path.join(os.tmpdir(),'focus-safety-')); t.after(()=>fs.rm(directory,{force:true,recursive:true})); return directory; }
async function setup(t) { const directory=await dir(t); const store=await Store.open({directory,seed}); await store.command('createOrder',{number:'101',name:'Кухня',templateId:store.snapshot().templates[0].id}); return {store,directory}; }

test('Corrupt data with no usable backup fails without replacing the file with an empty database',async t=>{
 const directory=await dir(t); const file=path.join(directory,'state.json'); await fs.writeFile(file,'{broken');
 await assert.rejects(Store.open({directory,seed}),/CORRUPT|RECOVERY|INVALID/);
 assert.equal(await fs.readFile(file,'utf8'),'{broken');
});
test('A future schema fails without downgrading or overwriting the file',async t=>{
 const {store,directory}=await setup(t); const state=store.snapshot(); state.schemaVersion=999; const text=JSON.stringify(state); const file=path.join(directory,'state.json'); await fs.writeFile(file,text);
 await assert.rejects(Store.open({directory,seed}),/SCHEMA|VERSION/); assert.equal(await fs.readFile(file,'utf8'),text);
});
test('Invalid order values leave both memory and the persisted file unchanged',async t=>{
 const {store,directory}=await setup(t); const before=store.export(); const order=store.snapshot().orders[0];
 await assert.rejects(store.command('saveOrder',{id:order.id,expectedVersion:order.version,patch:{notes:{invalid:true}}}));
 assert.equal(store.export(),before); assert.equal((await Store.open({directory,seed})).export(),before);
});
test('Deleting a template retains its existing orders and deleting the last template is forbidden',async t=>{
 const {store}=await setup(t); const original=store.snapshot().templates[0]; const order=structuredClone(store.snapshot().orders[0]);
 await store.command('createTemplate',{name:'Другой',sections:[]}); await store.command('deleteTemplate',{id:original.id});
 assert.deepEqual(store.snapshot().orders[0],order); assert.equal(store.snapshot().templates.length,1);
 const before=store.export(); await assert.rejects(store.command('deleteTemplate',{id:store.snapshot().templates[0].id})); assert.equal(store.export(),before);
});
test('Two same-version updates settle with one success and one conflict, without scheduler sleeps',async t=>{
 const {store}=await setup(t); const order=store.snapshot().orders[0];
 const results=await Promise.allSettled(['A','B'].map(notes=>store.command('saveOrder',{id:order.id,expectedVersion:order.version,patch:{notes}})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1); const rejected=results.find(r=>r.status==='rejected'); assert.match(rejected.reason.message,/CONFLICT/);
 assert.ok(['A','B'].includes(store.snapshot().orders[0].notes)); assert.equal(store.snapshot().orders[0].version,order.version+1);
});
test('Duplicate order identities in imported data are rejected without changing the database',async t=>{
 const {store}=await setup(t); const before=store.export(); const imported=store.snapshot(); imported.orders.push(structuredClone(imported.orders[0]));
 await assert.rejects(store.command('importData',{text:JSON.stringify(imported)})); assert.equal(store.export(),before);
});
