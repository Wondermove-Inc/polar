import assert from 'node:assert/strict';
import test from 'node:test';
import {mergeSource,languageFor,libraryView,words} from '../desktop/ui/model.mjs';
const a={id:'steam:1',name:'A',source:'steam'},b={id:'steam:2',name:'B',source:'steam'},c={id:'epic:a',name:'A',source:'epic'};
test('partial preserves unconfirmed records, complete prunes only its source',()=>{
 const partial=mergeSource([a,c],'steam',{items:[b],complete:false});
 assert.equal(partial.find(x=>x.id===a.id).unconfirmed,true);
 assert.deepEqual(mergeSource(partial,'steam',{items:[b],complete:true}).map(x=>x.id).sort(),[b.id,c.id].sort());
});
test('locale and selection use stable identities',()=>{
 assert.equal(languageFor(['ja-JP','en-US']),'en');assert.equal(languageFor(['fr']),'ko');
 assert.deepEqual(Object.keys(words.ko).sort(),Object.keys(words.en).sort());
 assert.deepEqual(libraryView([a,c,b],'favorites',[b.id]).map(x=>x.id),[b.id]);
});
test('legacy Epic shortcuts merge only with one matching installed artifact',()=>{
 const manual={id:'epic-short:legacy',source:'epic',bucket:'manual',name:'My name'};
 const installed={id:'epic:ns:cat:legacy',source:'epic',name:'Game'};
 const ambiguous={...installed,id:'epic:other:other:legacy'};
 assert.deepEqual(libraryView([manual,installed],'all',[]).map(x=>x.id),[installed.id]);
 assert.equal(libraryView([installed,manual],'favorites',[manual.id]).length,1);
 assert.equal(libraryView([installed,ambiguous,manual],'all',[]).length,3);
 assert.deepEqual(libraryView([installed,{...manual,id:installed.id}],'all',[]).map(x=>x.id),[installed.id]);
});
