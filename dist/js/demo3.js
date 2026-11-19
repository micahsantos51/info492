import { BOARD_KEY, emptyBoard, today, validDate, normalizeRfiRecords, mergeRfiRecords, applyJevClassification, due, rankable, recommend, wakeSnoozed, change, reorder, planCandidates, generatePlan, resetDemoBoard, jevInputForBoardItem, refreshClassificationState, recordClassificationError } from './demo3-core.js?v=20261118-evaluation-retry';
import { JEV_PRIORITY_LABELS } from './jev-priority.js?v=20261109-sharepoint';
import { describeEvidence, renderAssessmentEvidence } from './jev-evidence.js?v=20261118-handoffs';
import { requestJevEvaluation } from './workspace-assessment.js?v=20261118-handoffs';
import { parseCSV } from './rfi-data.js?v=20261110-rfi-upload';
const $ = id => document.getElementById(id);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SAMPLE_ORIGIN = 'answerTest.json';
let board = emptyBoard(), undo = null, active = null, drag = null, suggestedRanks = new Map(), sampleRecords = [], selectedIds = new Set(), sampleLoaded = false, sampleOrigin = SAMPLE_ORIGIN;
let configured = false, backendOrigin = '', batchRunning = false;
$('day').value = today();
const day = () => $('day').value || today();
const say = t => $('notice').textContent = t;
try { const saved = JSON.parse(localStorage.getItem(BOARD_KEY) || 'null'); if (saved?.version === 2 && Array.isArray(saved.items) && Array.isArray(saved.audit)) {
  board = saved;
  for (const item of board.items) {
    if (item.classification_state === 'pending') item.classification_state = 'not_classified';
    refreshClassificationState(item);
  }
} board.project = ''; } catch { say('Saved board could not be loaded.'); }
function save() { try { localStorage.setItem(BOARD_KEY, JSON.stringify(board)); $('saved').textContent = `Saved here · ${new Date().toLocaleTimeString()}`; return true; } catch { $('saved').textContent = 'Could not save. Export your board.'; return false; } }
function mutate(fn) { undo = structuredClone(board); try { fn(); save(); render(); } catch (e) { board = undo; undo = null; say(e.message); } }
function scope() { return board.items; }
function matches(x) { return `${x.record.rfi_id} ${x.record.title} ${x.owner || ''}`.toLowerCase().includes($('search').value.toLowerCase()); }
const needsClassification = item => item.classification_state !== 'pending'
  && (!item.classification || item.classification_state === 'stale' || item.classification_state === 'error');
const label = x => x.classification ? JEV_PRIORITY_LABELS[x.classification.category] : 'Not classified';
function badges(x) { const kind = x.classification ? x.classification.category : 'unclassified'; return `<span class="badge ${esc(kind)}">${esc(label(x))}</span>${x.classification ? `<span class="badge">${Math.round(x.classification.confidence * 100)}%</span>` : ''}${x.classification_state === 'stale' ? '<span class="badge warning-badge">Previous inputs</span>' : ''}${x.classification_state === 'pending' ? '<span class="badge">Working…</span>' : ''}${x.classification_state === 'error' ? '<span class="badge warning-badge">Try again</span>' : ''}`; }
function dateText(x, kind) { const date = kind === 'suggested' ? (validDate(x.due_override) ? x.due_override : x.record.due_date) : due(x); return date ? `${date}${date < day() ? ' · overdue' : date === day() ? ' · today' : ''}` : 'No date'; }
function why(x) { if (x.followup_due && x.followup_due <= day()) return 'Follow-up due'; if (due(x) && due(x) <= day()) return 'Due now'; return x.result.priority_reason || 'Not classified'; }
const button = (action, text, key, cls = '') => `<button class="${cls}" data-action="${action}" data-key="${esc(key)}">${text}</button>`;
function card(x, kind, index) {
  const key = x.key, rank = suggestedRanks.get(key), rankText = rank ? `Suggested #${rank}` : 'Not ranked'; return `<article class="card ${kind === 'planned' ? 'task' : ''}" data-key="${esc(key)}">${kind === 'planned' ? `<div class="handle" title="Move task">⠿<strong>${index + 1}</strong></div>` : ''}<div><div class="row"><span class="id">${esc(x.record.rfi_id)}</span><div class="flags">${badges(x)}</div></div><h3>${esc(x.record.title)}</h3>${['planned', 'suggested'].includes(kind) ? `<p class="rank-line">${kind === 'planned' ? `<strong>Today #${index + 1}</strong> · ` : ''}${rankText}</p>` : ''}${kind === 'reviewed' ? `<span class="badge green">${esc(x.outcome)}</span><p>${esc(x.note)}</p><p>${esc(x.reviewed_date)}${x.followup ? ` · Follow-up: ${esc(x.followup)}` : ''}</p>` : `<p>Needed by: <strong>${esc(dateText(x, kind))}</strong>${x.followup_due ? `<br>Follow-up: ${esc(x.followup_due)}` : ''}${x.owner ? `<br>Owner: ${esc(x.owner)}` : ''}</p>${kind === 'suggested' ? `<p>${esc(why(x).slice(0, 140))}</p>` : `<p>${esc(x.result.suggested_gc_review_action || 'Review this RFI.')}</p>`}${x.result.missing_information?.length ? `<p class="warning">More information may be needed.</p>` : ''}`}${kind === 'planned' && x.plan_date !== day() ? `<p class="warning">Added on ${esc(x.plan_date)}. Check this is still needed.</p>` : ''}${x.status === 'snoozed' ? `<p>Returns: ${esc(x.wake_date)} · ${esc(x.snooze_reason)}</p>` : ''}
<div class="actions">${kind === 'suggested' && !rankable(x) ? button('classify', 'Classify', key) : ''}${kind === 'suggested' && rankable(x) ? button('add', 'Add to today', key) : ''}${button('review', kind === 'reviewed' ? 'Details' : 'Review', key, kind === 'planned' ? 'primary' : '')}${kind === 'planned' ? button('up', '↑', key) + button('down', '↓', key) + button('snooze', 'Later', key) + button('remove', 'Remove', key) : ''}${kind === 'archive' && rankable(x) ? button('add', 'Plan again', key) : ''}</div></div></article>`;
}
function sourceKey(record) { return JSON.stringify([sampleOrigin, record.package_id, record.rfi_id]); }
function renderSourceList() { const query = $('search').value.trim().toLowerCase(), visible = sampleRecords.filter(r => `${r.rfi_id} ${r.title}`.toLowerCase().includes(query)); $('source-total').textContent = sampleLoaded ? `${visible.length} of ${sampleRecords.length} RFIs` : 'Loading RFIs…'; let rowsHtml = '<p class="empty-note">Could not load the demo RFI list.</p>'; if (sampleLoaded) { rowsHtml = visible.length ? visible.map(r => { const added = board.items.some(x => x.key === sourceKey(r)), checked = added || selectedIds.has(r.rfi_id); return `<label class="source-row"><input type="checkbox" data-source-id="${esc(r.rfi_id)}" ${checked ? 'checked' : ''} ${added ? 'disabled' : ''}><span class="source-id">${esc(r.rfi_id)}</span><span class="source-main"><strong>${esc(r.title)}</strong><small>Submitted ${esc(r.submitted_date || '—')} · Needed by ${esc(r.due_date || '—')}</small></span><span class="source-state">${added ? 'In review' : ''}</span></label>`; }).join('') : '<p class="empty-note">No matching RFIs.</p>'; } $('source-list').innerHTML = rowsHtml; const selectable = visible.filter(r => !board.items.some(x => x.key === sourceKey(r))), selected = selectable.filter(r => selectedIds.has(r.rfi_id)).length; $('select-visible').checked = selectable.length > 0 && selected === selectable.length; $('select-visible').indeterminate = selected > 0 && selected < selectable.length; $('select-visible').disabled = !selectable.length; $('add-selected').disabled = !selectedIds.size; $('add-selected').textContent = selectedIds.size ? `Add selected (${selectedIds.size})` : 'Add selected to review'; }
async function loadSampleList() { try { const response = await fetch('data/realData/answerTest.json', { cache: 'no-store' }); if (!response.ok) throw Error('Sample list unavailable.'); const payload = await response.json(); sampleOrigin = SAMPLE_ORIGIN; sampleRecords = normalizeRfiRecords(payload.records); sampleLoaded = true; } catch { sampleRecords = []; sampleLoaded = false; } renderSourceList(); }
function render() {
  wakeSnoozed(board, day()); for (const x of board.items) if (x.status === 'reviewed' && x.followup && x.followup <= day()) { x.history.push({ date: x.reviewed_date, outcome: x.outcome, note: x.note }); x.status = 'suggested'; x.followup_due = x.followup; x.followup = ''; }
  $('capacity').value = board.capacity;
  const list = scope(), planned = list.filter(x => x.status === 'planned').sort((a, b) => a.order - b.order), reviewed = list.filter(x => x.status === 'reviewed' && x.reviewed_date === day()), candidates = planCandidates(list, day()); suggestedRanks = new Map(candidates.map((x, i) => [x.key, i + 1]));
  $('generate').disabled = !candidates.length; $('classify-all').disabled = batchRunning || !board.items.some(needsClassification); $('plan-preview').textContent = `${candidates.length} ready · ${board.items.filter(needsClassification).length} to classify`;
  $('counts').textContent = `${planned.length} planned · ${list.filter(x => x.classification?.category === 'lacking_info').length} need info · ${reviewed.length} reviewed`;
  const suggestions = [...list.filter(x => x.status === 'suggested' && !rankable(x)), ...recommend(list, day())].filter(matches); $('suggestions').innerHTML = suggestions.slice(0, board.capacity).map(x => card(x, 'suggested')).join('') || '<p class="empty-note">No matching RFIs.</p>';
  if (suggestions.length > board.capacity) $('suggestions').innerHTML += `<p class="small">${suggestions.length - board.capacity} more. Raise the daily limit to see them.</p>`;
  $('tasks').innerHTML = planned.filter(matches).map(x => card(x, 'planned', planned.indexOf(x))).join('') || '<p class="empty-note">Generate today’s plan to get started.</p>'; $('more').innerHTML = planned.length > board.capacity ? '<p>More RFIs than today’s limit.</p>' : '';
  $('reviewed').innerHTML = reviewed.filter(matches).map(x => card(x, 'reviewed')).join('') || '<p class="empty-note">No RFIs reviewed yet.</p>';
  const archive = list.filter(x => x.status === 'snoozed' || x.status === 'reviewed' && x.reviewed_date !== day()); $('archive-count').textContent = `(${archive.length})`; $('archive').innerHTML = archive.filter(matches).map(x => card(x, 'archive')).join('') || '<p class="small">Nothing here yet.</p>'; $('undo').disabled = !undo; $('reset-board').disabled = batchRunning || board.items.some(x => x.classification_state === 'pending') || !board.items.length; renderSourceList();
}
function buildPlan() { mutate(() => { const count = generatePlan(board, day()); say(`Plan ready · ${count} RFIs.`); }); }
$('generate').onclick = () => { if (scope().some(x => x.status === 'planned')) $('generate-confirm').showModal(); else buildPlan(); }; $('cancel-generate').onclick = () => $('generate-confirm').close(); $('confirm-generate').onclick = () => { $('generate-confirm').close(); buildPlan(); };
$('capacity').onchange = () => { board.capacity = Number($('capacity').value); save(); render(); }; $('search').oninput = render; $('day').onchange = () => { if (validDate(day())) { render(); save(); } }; $('undo').onclick = () => { if (undo) { const current = board; board = undo; if (!save()) { board = current; say('Could not save Undo. Try again.'); return; } undo = null; render(); say('Last board change undone.'); } };
$('reset-board').onclick = () => $('reset-confirm').showModal();
$('cancel-reset').onclick = () => $('reset-confirm').close();
$('confirm-reset').onclick = () => {
  if (batchRunning || board.items.some(x => x.classification_state === 'pending')) { say('Wait for classification to finish before resetting.'); return; }
  const previous = structuredClone(board), previousUndo = undo;
  board = resetDemoBoard(board);
  if (!save()) { board = previous; undo = previousUndo; say('Reset was not saved. Your board has been kept.'); return; }
  undo = previous; selectedIds.clear(); active = null; $('search').value = ''; $('reset-confirm').close(); render();
  say('Demo board cleared. Original RFI records are unchanged. Click Undo before another board change or refresh to restore.');
  $('undo').focus();
};
$('restore').onclick = () => mutate(() => { const items = scope().filter(x => x.status === 'planned'), sorted = recommend(items.map(x => ({ ...x, status: 'suggested' })), day()), keys = sorted.map(x => x.key); for (const x of items) { x.order = keys.includes(x.key) ? keys.indexOf(x.key) : keys.length + x.order; x.manual = false; } board.audit.push({ at: new Date().toISOString(), action: 'restore-order', project: board.project }); });
function updateClassifyButton() {
  const item = board.items.find(entry => entry.key === active);
  if (!item) return;
  const input = JSON.stringify(jevInputForBoardItem(item, $('due').value));
  const unchanged = Boolean(item.classification && input === item.classification_input);
  const pending = item.classification_state === 'pending';
  $('classify-one').disabled = pending || unchanged;
  const hint = $('classification-hint');
  if (hint) hint.textContent = pending ? 'Jev is reviewing this RFI.'
    : unchanged ? 'These dates and this description have already been classified. Change the needed-by date to request another assessment.'
    : '';
}
function saveReviewDueDate(item, date) {
  if (item.due_override === date) return true;
  const previous = structuredClone(board), previousUndo = undo;
  item.due_override = date;
  refreshClassificationState(item);
  board.audit.push({ at: new Date().toISOString(), key: item.key, action: 'planning-details', date, owner: item.owner || '' });
  if (!save()) { board = previous; undo = previousUndo; render(); say('Planning details were not saved. Your previous date has been kept.'); return false; }
  undo = previous;
  render();
  return true;
}
function setConnectionStatus(message) { const status = $('jev-connection-status'); if (status) status.textContent = message; }
async function checkConnection() { setConnectionStatus('Connecting to Jev… The first check can take about a minute after the service has been idle.'); try { const response = await fetch(`${backendOrigin}/api/jev/config`, { cache: 'no-store', signal: AbortSignal.timeout(75000) }); let config; try { config = await response.json(); } catch { throw Error(`Backend returned HTTP ${response.status} without Jev configuration metadata.`); } if (!response.ok) throw Error(config.error || `Backend error (HTTP ${response.status}).`); if (config.token_required) throw Error('The deployed backend still requires a team token. Deploy the current server version.'); configured = config.configured === true && !config.token_required; setConnectionStatus(configured ? 'Ready · no visitor key or backend settings needed.' : 'Jev is not configured on the backend. The site owner must add the server-side Jev key.'); } catch (error) { configured = false; const reason = error instanceof TypeError ? 'The browser could not reach the backend (network or CORS).' : error.message; setConnectionStatus(`Jev unavailable: ${reason} The backend ALLOWED_ORIGINS must include ${location.origin}; confirm the current server is deployed and awake.`); } }
async function initializeConnection() { try { const response = await fetch('data/jev-config.json', { cache: 'no-store' }); if (!response.ok) throw Error(`Could not load the Jev backend address (HTTP ${response.status}).`); const config = await response.json(); backendOrigin = config.backend_origin ? new URL(config.backend_origin).origin : location.origin; } catch (error) { backendOrigin = location.origin; setConnectionStatus(`Jev setup unavailable: ${error.message}`); } await checkConnection(); }
function reportClassificationProblem(key, message) {
  say(message);
  if (active === key && $('detail').open) $('form-error').textContent = message;
}
async function classifyItem(key) {
  const item = board.items.find(x => x.key === key);
  if (!item || item.classification_state === 'pending') return false;
  if (!$('jev-consent').checked) {
    reportClassificationProblem(key, 'Enable “Allow Jev to review” above the RFI list, then classify this RFI.');
    if (!$('detail').open) $('jev-consent').focus();
    return false;
  }
  if (!configured) await checkConnection();
  if (!configured) { reportClassificationProblem(key, 'Jev is unavailable. Check the connection and try again.'); return false; }
  if (!board.items.includes(item) || item.classification_state === 'pending' || !$('jev-consent').checked) return false;

  const requestInput = jevInputForBoardItem(item);
  const keyForInput = JSON.stringify(requestInput);
  if (item.classification && item.classification_input === keyForInput) {
    refreshClassificationState(item);
    return true;
  }
  if (active === key && $('detail').open) $('form-error').textContent = '';
  item.classification_state = 'pending';
  render();
  updateClassifyButton();
  try {
    const evaluation = await requestJevEvaluation(backendOrigin, item.record.rfi_id, requestInput);
    if (!board.items.includes(item)) return false;
    applyJevClassification(item, evaluation, keyForInput);
    refreshClassificationState(item);
    board.audit.push({ at: item.analyzed_at, key, action: 'jev-classification',
      category: evaluation.category, confidence: evaluation.confidence, model: evaluation.model, promptVersion: evaluation.promptVersion });
    save();
    say(item.classification_state === 'stale'
      ? `${item.record.rfi_id} changed during evaluation. Classify again with the current inputs.`
      : `${item.record.rfi_id} classified: ${JEV_PRIORITY_LABELS[evaluation.category]} · ${Math.round(evaluation.confidence * 100)}% confidence.`);
    return true;
  } catch (error) {
    if (!board.items.includes(item)) return false;
    recordClassificationError(item, keyForInput, error.message);
    save();
    say(`${item.record.rfi_id}: ${error.message}`);
    return false;
  } finally {
    render();
    if (active === key && $('detail').open && board.items.includes(item)) {
      renderDetailAssessment(item);
      $('classify-one').textContent = item.classification ? 'Classify again' : 'Classify with Jev';
      updateClassifyButton();
    }
  }
}
$('classify-all').onclick = async () => { const pending = board.items.filter(needsClassification).slice(0, 50); if (!$('jev-consent').checked) return say('Allow Jev to review the selected RFIs first.'); batchRunning = true; render(); try { for (let i = 0; i < pending.length; i++) { say(`Classifying ${pending[i].record.rfi_id} (${i + 1} of ${pending.length})…`); if (!await classifyItem(pending[i].key)) break; } } finally { batchRunning = false; render(); } };
function detailEvidence(item) {
  const source = jevInputForBoardItem(item);
  if (!item.classification) return renderAssessmentEvidence({evidence: describeEvidence(source)}, {preview: true});
  let assessedInput;
  try { assessedInput = JSON.parse(item.classification_input); } catch { /* older board */ }
  if (!assessedInput || !Object.hasOwn(assessedInput, 'description')) {
    return '<p>Source inputs for this assessment were not recorded.</p>';
  }
  const outdated = JSON.stringify(source) !== item.classification_input;
  const notice = outdated ? '<p class="warning">These excerpts belong to a previous assessment. Classify again to assess the current inputs.</p>' : '';
  return notice + renderAssessmentEvidence({evidence: describeEvidence(assessedInput)}, {expanded: true});
}
function renderDetailAssessment(item) {
  const effectiveDate = due(item);
  $('detail-body').innerHTML = `<div class="flags">${badges(item)}</div>
    <p><strong>Needed by:</strong> ${esc(effectiveDate || 'Not provided')} · <strong>Submitted:</strong> ${esc(item.record.submitted_date || 'Not provided')}</p>
    ${item.classification_state === 'error' ? `<p class="warning" role="alert">Classification failed: ${esc(item.classification_error?.message)}. You can retry this RFI.</p>` : ''}
    <p><strong>Priority:</strong> ${esc(item.result.priority_reason || 'Not classified yet.')}</p>
    <p><strong>Description</strong></p><blockquote>${esc(item.record.description)}</blockquote>
    ${detailEvidence(item)}
    <p><strong>Next step:</strong> ${esc(item.result.suggested_gc_review_action)}</p>
    <p class="small" id="classification-hint" aria-live="polite"></p>`;
}
function openDetail(key) {
  active = key;
  const item = board.items.find(entry => entry.key === key);
  if (!item) return;
  $('detail-title').textContent = `${item.record.rfi_id} — ${item.record.title}`;
  renderDetailAssessment(item);
  $('classify-one').textContent = item.classification ? 'Classify again' : 'Classify with Jev';
  $('due').value = jevInputForBoardItem(item).due_date || '';
  $('owner').value = item.owner || '';
  updateClassifyButton();
  if (!$('detail').open) {
    $('note').value = '';
    $('followup').value = '';
    $('form-error').textContent = '';
    $('detail').showModal();
  }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-action]'); if (!b) return; const { action, key } = b.dataset; if (action === 'review') return openDetail(key); if (action === 'classify') return classifyItem(key); if (action === 'snooze') { active = key; $('wake').value = ''; $('wake').min = day(); $('snooze-reason').value = ''; $('snooze-error').textContent = ''; $('snooze-dialog').showModal(); return; } mutate(() => { if (action === 'up' || action === 'down') { const list = scope().filter(x => x.status === 'planned').sort((a, b) => a.order - b.order), i = list.findIndex(x => x.key === key), target = list[i + (action === 'up' ? -1 : 1)]; if (target) reorder(board, key, target.key); } else change(board, key, action, {}, day()); }); });
let pointerStart = null, dropKey = null; $('tasks').addEventListener('pointerdown', e => { const handle = e.target.closest('.handle'); if (!handle || e.button !== 0) return; const task = handle.closest('.task'); drag = task.dataset.key; pointerStart = [e.clientX, e.clientY]; dropKey = null; handle.setPointerCapture(e.pointerId); e.preventDefault(); }); $('tasks').addEventListener('pointermove', e => { if (!drag || !pointerStart || Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) < 8) return; for (const c of $('tasks').querySelectorAll('.task')) { c.classList.toggle('dragging', c.dataset.key === drag); c.classList.remove('over'); } const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('#tasks .task'); dropKey = target?.dataset.key || null; if (target && dropKey !== drag) target.classList.add('over'); }); $('tasks').addEventListener('pointerup', () => { if (!drag) return; const source = drag, target = dropKey; drag = null; pointerStart = null; dropKey = null; if (source && target && source !== target) mutate(() => reorder(board, source, target)); else render(); }); $('tasks').addEventListener('pointercancel', () => { drag = null; pointerStart = null; dropKey = null; render(); });
$('due').addEventListener('input', updateClassifyButton);
$('due').addEventListener('change', updateClassifyButton);
$('classify-one').onclick = () => { if (!active) return; const item = board.items.find(x => x.key === active); if (!item) return; if ($('due').value && !validDate($('due').value)) { $('form-error').textContent = 'Enter a valid date.'; return; } if (!saveReviewDueDate(item, $('due').value)) return; classifyItem(active); }; $('close-detail').onclick = () => $('detail').close(); $('cancel-snooze').onclick = () => $('snooze-dialog').close(); $('save-details').onclick = () => { if ($('due').value && !validDate($('due').value)) { $('form-error').textContent = 'Enter a valid date.'; return; } mutate(() => { const x = board.items.find(i => i.key === active); x.due_override = $('due').value; refreshClassificationState(x); x.owner = $('owner').value.trim(); board.audit.push({ at: new Date().toISOString(), key: active, action: 'planning-details', date: x.due_override, owner: x.owner }); }); renderDetailAssessment(board.items.find(i => i.key === active)); $('form-error').textContent = 'Planning details saved.'; updateClassifyButton(); };
$('review-form').onsubmit = e => { e.preventDefault(); const previous = structuredClone(board); try { change(board, active, 'review', { outcome: $('outcome').value, note: $('note').value, followup: $('followup').value }, day()); undo = previous; save(); render(); $('detail').close(); say('Review saved.'); } catch (e) { board = previous; $('form-error').textContent = e.message; } }; $('snooze-form').onsubmit = e => { e.preventDefault(); try { const previous = structuredClone(board); change(board, active, 'snooze', { date: $('wake').value, reason: $('snooze-reason').value }, day()); undo = previous; save(); render(); $('snooze-dialog').close(); } catch (e) { $('snooze-error').textContent = e.message; } };
$('source-list').addEventListener('change', e => { const id = e.target.dataset.sourceId; if (id) { if (e.target.checked && selectedIds.size >= 50) { e.target.checked = false; say('You can select up to 50 RFIs at a time.'); return; } if (e.target.checked) selectedIds.add(id); else selectedIds.delete(id); renderSourceList(); } });
$('select-visible').onchange = () => { const query = $('search').value.trim().toLowerCase(); for (const r of sampleRecords.filter(x => `${x.rfi_id} ${x.title}`.toLowerCase().includes(query))) { if (board.items.some(x => x.key === sourceKey(r))) continue; if ($('select-visible').checked) selectedIds.add(r.rfi_id); else selectedIds.delete(r.rfi_id); } renderSourceList(); };
$('add-selected').onclick = () => { const records = sampleRecords.filter(r => selectedIds.has(r.rfi_id)); if (!records.length) return; mutate(() => { const result = mergeRfiRecords(board, records, sampleOrigin); selectedIds.clear(); say(`${result.added} RFIs added to review.`); }); };
$('choose-rfi-file').onclick = () => $('rfi-upload').click();
$('rfi-upload').onchange = async () => { const file = $('rfi-upload').files?.[0]; if (!file) return; try { if (file.size > 1_000_000) throw Error('Choose a file smaller than 1 MB.'); const contents = await file.text(); let rows; if (/\.json$/i.test(file.name) || file.type === 'application/json') { const payload = JSON.parse(contents); rows = Array.isArray(payload) ? payload : payload?.records; } else rows = parseCSV(contents); const records = normalizeRfiRecords(rows); sampleRecords = records; $('upload-filename').textContent = file.name; sampleOrigin = `${file.name} · ${crypto.randomUUID()}`; sampleLoaded = true; selectedIds = new Set(records.map(r => r.rfi_id)); $('search').value = ''; $('upload-status').textContent = `Loaded ${records.length} RFIs from ${file.name}. Select rows to add them to your review.`; say(`${records.length} RFIs ready to add.`); renderSourceList(); } catch (error) { $('upload-status').textContent = error.message; say(`Could not import file: ${error.message}`); } finally { $('rfi-upload').value = ''; } };
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ ...board, exported_at: new Date().toISOString(), scope: 'Standalone local prototype. No authentication or cross-device sync.' }, null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = `demo3-board-${day()}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
window.addEventListener('storage', e => { if (e.key === BOARD_KEY) { try { const next = JSON.parse(e.newValue); if (next?.version === 2) { board = next; undo = null; render(); say('Board updated from another tab.'); } } catch { } } });
render(); save(); initializeConnection(); loadSampleList();
