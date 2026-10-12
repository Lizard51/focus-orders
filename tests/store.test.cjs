const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {Store}=require('../src/store.cjs');
const seed=require('../src/seed.json');
const clone=x=>structuredClone(x);
const textSection=()=>({id:'section-check',title:'Моя проверка',type:'items',items:[{id:'item-check',t:'Согласовать эскиз',d:0}]});
const qSection=()=>({id:'section-question',title:'Вопросы менеджеру',type:'q',items:[{id:'item-question',t:'Где розетка?',d:0}]});
const fSection=()=>({id:'section-field',title:'Параметры',type:'fields',items:[{id:'item-field',k:'Мой параметр',v:'Моё значение'}]});
async function fixture(t,options={}){const directory=await fs.mkdtemp(path.join(os.tmpdir(),'focus-orders-test-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));return {directory,store:await Store.open({directory,seed:clone(seed),...options})}}
async function create(store,number='101',templateId=store.snapshot().templates[0].id){await store.command('createOrder',{templateId,number,name:'Кухня '+number});return store.snapshot().orders.at(-1)}
async function update(store,order,patch){return store.command('saveOrder',{id:order.id,expectedVersion:order.version,patch})}

test('Initial template preserves all original checklist sections and starts with no fictional orders',async t=>{
 const {store}=await fixture(t);const db=store.snapshot();
 assert.equal(db.orders.length,0);assert.equal(db.templates.length,1);
 assert.deepEqual(db.templates[0].sections.map(s=>s.title),['ВАЖНО','ФУР','ФАСАДЫ','СБОРКА','ВОПРОСЫ: Техника','ВОПРОСЫ: Помещение','ВОПРОСЫ: Конструктив','ВОПРОСЫ: Документы','проект','техника','ПРОВЕРКА','Для производства','Если плитные фасады','КЛ (скиф и слоткс)','Ждем']);
 assert.equal(db.templates[0].sections.find(s=>s.title==='ПРОВЕРКА').items.length,16);
});
test('Two orders have independent values, checkmarks and notes',async t=>{
 const {store}=await fixture(t);const a=await create(store,'101'),b=await create(store,'102');
 const sections=[textSection(),fSection(),qSection()];sections[0].items[0].d=1;
 await update(store,a,{sections,notes:'Заметка только первого заказа'});
 const db=store.snapshot();assert.equal(db.orders.find(o=>o.id===a.id).notes,'Заметка только первого заказа');assert.equal(db.orders.find(o=>o.id===b.id).notes,'');
 assert.notDeepEqual(db.orders[0].sections,db.orders[1].sections);
 assert.notEqual(db.orders[0].sections,db.templates[0].sections);
});
test('Edits remain after closing and reopening the store',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store);
 await update(store,o,{sections:[textSection(),fSection(),qSection()],notes:'Строка один\nСтрока два'});
 const reopened=await Store.open({directory,seed});const saved=reopened.snapshot().orders[0];
 assert.equal(saved.notes,'Строка один\nСтрока два');assert.equal(saved.sections[1].items[0].v,'Моё значение');assert.equal(saved.sections[2].items[0].t,'Где розетка?');
});
test('Named templates can be selected and edited without changing existing orders',async t=>{
 const {store}=await fixture(t);await store.command('createTemplate',{name:'Кухня особая',sections:[textSection(),fSection()]});
 const template=store.snapshot().templates.at(-1);const o=await create(store,'201',template.id);
 await store.command('saveTemplate',{id:template.id,expectedVersion:template.version,patch:{name:'Кухня обновлённая',sections:[qSection()]}});
 assert.equal(store.snapshot().orders.find(x=>x.id===o.id).sections[0].title,'Моя проверка');
 const next=await create(store,'202',template.id);assert.equal(next.sections[0].type,'q');
 assert.equal(next.templateName,'Кухня обновлённая');
});
test('Order checklist, questions and arbitrary parameter names can be added, edited and removed',async t=>{
 const {store}=await fixture(t);const o=await create(store);await update(store,o,{sections:[textSection(),qSection(),fSection()],notes:'Моя запись'});
 let current=store.snapshot().orders[0];assert.deepEqual(current.sections.map(s=>s.type),['items','q','fields']);
 const sections=clone(current.sections);sections[0].items.push({id:'item-second',t:'Проверить полку',d:1});sections[2].items[0].k='Свободное название';
 await update(store,current,{sections});current=store.snapshot().orders[0];assert.equal(current.sections[0].items.length,2);assert.equal(current.sections[2].items[0].k,'Свободное название');
 await update(store,current,{sections:current.sections.slice(1)});assert.equal(store.snapshot().orders[0].sections.length,2);
});
test('Archive is read-only and restoration retains every part of the order',async t=>{
 const {store}=await fixture(t);const o=await create(store);const sections=[textSection(),fSection(),qSection()];sections[0].items[0].d=1;
 await update(store,o,{sections,notes:'Сохранить в архиве'});const before=store.snapshot().orders[0];
 await store.command('archiveOrder',{id:o.id});assert.equal(store.snapshot().orders[0].status,'archived');
 await assert.rejects(update(store,store.snapshot().orders[0],{notes:'Нельзя менять'}),/ARCHIVED/);
 await store.command('restoreOrder',{id:o.id});const restored=store.snapshot().orders[0];
 assert.equal(restored.status,'active');assert.deepEqual(restored.sections,before.sections);assert.equal(restored.notes,before.notes);
});
test('Stale versions are rejected rather than overwriting newer changes',async t=>{
 const {store}=await fixture(t);const o=await create(store);await update(store,o,{notes:'Новое'});
 await assert.rejects(update(store,o,{notes:'Устаревшее'}),/CONFLICT/);assert.equal(store.snapshot().orders[0].notes,'Новое');
});
test('Legacy Data JSON imports all orders, template, fields and completed items',async t=>{
 const {store}=await fixture(t);const legacy={tpl:{sections:[textSection(),fSection()]},orders:[{id:'old-a',num:'77',sections:[textSection(),fSection(),qSection()]},{id:'old-b',num:'78',sections:[qSection()]}],cur:'old-b'};
 legacy.orders[0].sections[0].items[0].d=1;
 const preview=store.previewImport(JSON.stringify(legacy));assert.equal(preview.orders.length,2);
 await store.command('importData',{text:JSON.stringify(legacy)});const db=store.snapshot();
 assert.deepEqual(db.orders.map(o=>o.number),['77','78']);assert.equal(db.orders[0].sections[0].items[0].d,1);assert.equal(db.orders[0].sections[1].items[0].v,'Моё значение');assert.equal(db.templates.length,1);
});
test('Malformed or structurally invalid imports leave the current database intact',async t=>{
 const {store}=await fixture(t);await create(store);const before=store.export();
 for(const text of ['{broken','{}',JSON.stringify({tpl:{sections:[]},orders:[{num:'bad',sections:[{title:'Bad',type:'fields',items:[{k:42,v:{}}]}]}]})]){
  await assert.rejects(store.command('importData',{text}));assert.equal(store.export(),before);
 }
});
test('Manual whole-database export/import preserves orders and multiple templates',async t=>{
 const {store}=await fixture(t);await create(store);await store.command('createTemplate',{name:'Пустой',sections:[]});const exported=store.export();
 const other=await fixture(t);await other.store.command('importData',{text:exported});
 assert.deepEqual(other.store.snapshot().orders,store.snapshot().orders);assert.deepEqual(other.store.snapshot().templates,store.snapshot().templates);
});
test('Failed atomic replacement reports an error and changes neither memory nor saved orders',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store);const before=store.export();
 const failing=await Store.open({directory,seed,fsOps:{rename:async(from,to)=>{if(to===path.join(directory,'state.json'))throw new Error('TEST_DISK_FAILURE');return fs.rename(from,to)}}});
 await assert.rejects(update(failing,failing.snapshot().orders[0],{notes:'Не сохранено'}),/TEST_DISK_FAILURE/);
 assert.equal(failing.export(),before);const reopened=await Store.open({directory,seed});assert.equal(reopened.snapshot().orders[0].notes,'');assert.equal(reopened.snapshot().orders[0].id,o.id);
});
test('Automatic local backup can restore previous data after later changes',async t=>{
 const {store}=await fixture(t);const o=await create(store);await update(store,o,{notes:'До изменения'});
 const files=await store.listBackups();assert.ok(files.length>0);const selected=files[0].id;
 await update(store,store.snapshot().orders[0],{notes:'После изменения'});await store.command('restoreBackup',{id:selected});
 assert.equal(store.snapshot().orders[0].notes,'До изменения');
 await assert.rejects(store.command('restoreBackup',{id:'../state.json'}));
});
test('Corrupt primary data recovers from a validated automatic backup with a visible warning',async t=>{
 const {store,directory}=await fixture(t);const o=await create(store);await update(store,o,{notes:'Последняя сохранённая заметка'});
 await fs.writeFile(path.join(directory,'state.json'),'{broken');const recovered=await Store.open({directory,seed});
 assert.equal(recovered.snapshot().orders[0].notes,'Последняя сохранённая заметка');assert.ok(recovered.warnings.length>0);
});
test('Serial commands both succeed and defensive snapshots cannot mutate stored state',async t=>{
 const {store}=await fixture(t);const a=await create(store,'1'),b=await create(store,'2');
 await Promise.all([update(store,a,{notes:'A'}),update(store,b,{notes:'B'})]);
 const exposed=store.snapshot();exposed.orders[0].notes='Outside mutation';const saved=store.snapshot();assert.equal(saved.orders[0].notes,'A');assert.equal(saved.orders[1].notes,'B');
});
