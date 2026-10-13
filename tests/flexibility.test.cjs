'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store.cjs');
const seed = require('../src/seed.json');
const orderViews = ['fields', 'q', 'notes', 'items'];
const customSections = [
  {id:'table', title:'Размеры', type:'fields', items:[{id:'height',k:'Высота',v:'900'}]},
  {id:'check', title:'Параметры с галочками', type:'items', view:'fields', items:[{id:'checked',t:'Размер согласован',d:1}]},
  {id:'q2', title:'Помещение', type:'q', items:[{id:'b',t:'Второй?',d:0},{id:'a',t:'Первый?',d:0}]},
  {id:'q1', title:'Техника', type:'q', items:[]},
];
async function fixture(t){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'focus-flex-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,store:await Store.open({directory,seed})};}
async function create(store, extra={}) {await store.command('createOrder',{templateId:store.snapshot().templates[0].id,number:'78',name:'Старое имя',...extra});return store.snapshot().orders.at(-1);}
async function save(store,o,patch){return store.command('saveOrder',{id:o.id,expectedVersion:o.version,patch});}
test('Numeric block preserves leading zeroes, derives name and survives restart',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store,{block:'00445'});
 assert.equal(o.block,'00445');assert.equal(o.name,'Блок 00445');assert.equal(o.number,'78');
 await save(store,o,{block:'446'});const reopened=await Store.open({directory,seed});assert.equal(reopened.snapshot().orders[0].name,'Блок 446');
});
test('Old schema1 names and original section placement are retained',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store);const before=store.export();
 const reopened=await Store.open({directory,seed});assert.equal(reopened.export(),before);assert.equal(reopened.snapshot().orders[0].name,'Старое имя');assert.equal(o.block,undefined);
});
test('Mixed parameter sections and reordered views/rows survive export/import/restart independently',async t=>{
 const {store,directory}=await fixture(t);const first=await create(store);const other=await create(store);
 await save(store,first,{sections:customSections,viewOrder:orderViews});
 assert.deepEqual(store.snapshot().orders[1],other);
 const reopened=await Store.open({directory,seed});assert.deepEqual(reopened.snapshot().orders[0].sections,customSections);assert.deepEqual(reopened.snapshot().orders[0].viewOrder,orderViews);
 const target=await fixture(t);await target.store.command('importData',{text:store.export()});assert.deepEqual(target.store.snapshot().orders,reopened.snapshot().orders);
});
test('Template view order and mixed sections are inherited only by future orders',async t=>{
 const {store}=await fixture(t);const old=await create(store);const tpl=store.snapshot().templates[0];
 await store.command('saveTemplate',{id:tpl.id,expectedVersion:tpl.version,patch:{sections:customSections,viewOrder:orderViews}});
 const newer=await create(store);assert.deepEqual(newer.sections,customSections);assert.deepEqual(newer.viewOrder,orderViews);assert.deepEqual(store.snapshot().orders[0],old);
});
test('Invalid view order, incompatible section placement and non-digit blocks leave disk and memory intact',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store);const before=store.export();
 for(const patch of [{viewOrder:['items','items','q','notes']},{viewOrder:['q']},{viewOrder:['items','fields','q','other']},{block:'445a'},{block:''},{sections:[{...customSections[1],view:'q'}]}])await assert.rejects(save(store,o,patch),/INVALID/);
 assert.equal(store.export(),before);assert.equal((await Store.open({directory,seed})).export(),before);
});
test('Archive denies reorder and parameter checklist editing',async t=>{
 const {store}=await fixture(t);const o=await create(store);await store.command('archiveOrder',{id:o.id});const archived=store.snapshot().orders[0];
 await assert.rejects(save(store,archived,{sections:customSections,viewOrder:orderViews}),/ARCHIVED/);
});
