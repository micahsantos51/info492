import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyBoard,normalizeRfiRecords,mergeRfiRecords,mergeAccountRfiRecords,accountRfiId,applyJevClassification,cardDueDate,change,reorder,recommend,wakeSnoozed,validDate,generatePlan,planCandidates,resetDemoBoard} from '../js/demo3-core.js';

const records=[
  {rfi_id:'A',title:'Clarification',description:'Confirm the structural detail before proceeding.',submitted_date:'2026-10-29',due_date:'2026-11-02',package_id:'P'},
  {rfi_id:'B',title:'Routing',description:'Confirm the service route before proceeding.',submitted_date:'2026-10-29',due_date:null,package_id:'P'},
];
function fixture(){const board=emptyBoard();mergeRfiRecords(board,records);const [a,b]=board.items;applyJevClassification(a,{category:'mid',confidence:.8},JSON.stringify({id:'A'}));applyJevClassification(b,{category:'high',confidence:.9},JSON.stringify({id:'B'}));return board;}

test('imports CSV-style workbook fields and normalizes IDs, dates and descriptions',()=>{
 const [r]=normalizeRfiRecords([{rfi_number:'R200-CRE-06251',file_name:'sample.pdf',required_return_date:'2022-04-10',rfi_description:'A complete source description.',date_submitted:'2022-03-21'}]);
 assert.equal(r.rfi_id,'R200-CRE-06251');assert.equal(r.due_date,'2022-04-10');assert.equal(r.submitted_date,'2022-03-21');assert.equal(r.title,'sample');
 assert.throws(()=>normalizeRfiRecords([{rfi_id:'A',description:'text'},{rfi_id:'A',description:'text'}]),/unique/);
 assert.equal(validDate('2026-02-30'),false);
});

test('Jev categories map to plan tiers; lacking information stays unranked',()=>{
 const board=fixture(),[a,b]=board.items;assert.equal(a.result.priority,'P1');assert.equal(b.result.priority,'P0');
 applyJevClassification(a,{category:'lacking_info',confidence:.7},'new-input');assert.equal(a.result.priority,null);assert.equal(a.result.assessment_state,'lacking_info');
 assert.deepEqual(recommend(board.items,'2026-10-30').map(x=>x.record.rfi_id),['B']);
});

test('same imported record is refreshed without losing human planning fields',()=>{
 const board=fixture(),a=board.items[0];change(board,a.key,'add',{},'2026-10-30');a.owner='GC';a.due_override='2026-11-05';
 mergeRfiRecords(board,[{...records[0],description:'Updated source description.'}]);
 assert.equal(board.items.length,2);assert.equal(a.owner,'GC');assert.equal(a.due_override,'2026-11-05');assert.equal(a.classification,null);assert.equal(a.status,'planned');
});

test('account RFI merges retain private routing and thread fields for API actions',()=>{
 const board=emptyBoard(),origin='account:user-1';
 const assigned={...records[0],rfi_id:'abc123',id:'abc123',account_id:'abc123',sender_name:'Sender',sender_email:'sender@example.com',files:[{name:'detail.pdf'}],messages:[{text:'Earlier reply'}],account_status:'submitted'};
 mergeAccountRfiRecords(board,[assigned],origin);
 const item=board.items[0];assert.equal(item.record.account_id,'abc123');assert.equal(item.record.sender_email,'sender@example.com');assert.equal(item.record.messages[0].text,'Earlier reply');
 const updated={...assigned,account_status:'reviewed',messages:[...assigned.messages,{text:'New reply'}]};
 mergeAccountRfiRecords(board,[updated],origin);
 assert.equal(item.record.account_id,'abc123');assert.equal(item.record.account_status,'reviewed');assert.equal(item.record.messages.length,2);
 assert.equal(accountRfiId(item.record),'abc123');
 assert.equal(accountRfiId({rfi_id:'fallback-id'}),'fallback-id');
});

test('cards fall back to the source due date when no planning or decision date exists',()=>{
 const item=fixture().items[0];
 assert.equal(cardDueDate(item,'planned'),'2026-11-02');
 item.due_override='2026-11-04';
 assert.equal(cardDueDate(item,'planned'),'2026-11-04');
 assert.equal(cardDueDate(item,'suggested'),'2026-11-04');
});

test('priority outranks date; add and reorder preserve one task per item',()=>{
 const board=fixture(),[a,b]=board.items;a.due_override='2026-10-29';assert.deepEqual(recommend(board.items,'2026-10-30').map(x=>x.record.rfi_id),['B','A']);
 change(board,a.key,'add',{},'2026-10-30');change(board,a.key,'add',{},'2026-10-30');change(board,b.key,'add',{},'2026-10-30');assert.equal(board.items.filter(x=>x.status==='planned').length,2);reorder(board,b.key,a.key);assert.equal(board.items.sort((x,y)=>x.order-y.order)[0].record.rfi_id,'B');
});

test('snooze wakes on its date; review records an action without closing source RFI',()=>{
 const board=fixture(),item=board.items[0],source=structuredClone(item.record);change(board,item.key,'snooze',{date:'2026-11-01',reason:'Await response'},'2026-10-30');wakeSnoozed(board,'2026-10-31');assert.equal(item.status,'snoozed');wakeSnoozed(board,'2026-11-01');assert.equal(item.status,'suggested');
 change(board,item.key,'review',{outcome:'Clarification requested',note:'Recorded follow-up'},'2026-10-30');assert.equal(item.status,'reviewed');assert.deepEqual(item.record,source);assert.equal(item.record.status,undefined);
});

test('review notes are optional for scheduled follow-up and no further action outcomes',()=>{
 for(const outcome of ['Follow-up scheduled','Reviewed — no further action today']){
  const board=fixture(),item=board.items[0];
  change(board,item.key,'review',{outcome,note:''},'2026-10-30');
  assert.equal(item.status,'reviewed');assert.equal(item.outcome,outcome);assert.equal(item.note,'');
 }
 const board=fixture();
 assert.throws(()=>change(board,board.items[0].key,'review',{outcome:'Clarification requested',note:'  '},'2026-10-30'),/record your action/);
});

test('plan generation honors capacity, project scope and completed work',()=>{
 const board=fixture();board.capacity=3;const item=board.items[0];item.status='planned';item.manual=true;item.order=0;const other=structuredClone(board.items[1]);other.key='other';other.record.package_id='Other';other.status='planned';other.order=99;board.items.push(other);board.project='P';
 assert.equal(generatePlan(board,'2026-10-30'),2);assert.equal(board.items.find(x=>x.record.rfi_id==='B'&&x.key!=='other').order,0);assert.equal(item.order,1);assert.equal(item.manual,false);assert.equal(other.order,99);
 item.status='reviewed';generatePlan(board,'2026-10-30');assert.equal(item.status,'reviewed');assert.equal(planCandidates([item],'2026-10-30').length,0);
});


test('reset clears every board lane without changing the source or undo snapshot',()=>{
 const board=fixture();board.capacity=10;
 board.items[0].status='reviewed';board.items[0].note='Keep in undo';board.items[1].status='snoozed';
 board.audit.push({action:'review'});
 const before=structuredClone(board),source=structuredClone(records);
 const cleared=resetDemoBoard(board);
 assert.equal(cleared.items.length,0);assert.equal(cleared.audit.length,0);assert.equal(cleared.capacity,10);
 assert.deepEqual(board,before);assert.deepEqual(records,source);
 board.items[0].classification_state='pending';assert.throws(()=>resetDemoBoard(board),/Wait/);
});
