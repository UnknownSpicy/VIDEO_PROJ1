'use strict';
const $ = (selector) => document.querySelector(selector);
const state = {token: '', analysis: null, mode: 'transcript', poll: null, editing: null, configured: false, models: []};
const escapeHTML = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
const time = (n) => {
  const ms = Math.round(Number(n) * 1000);
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${h ? String(h).padStart(2,'0') + ':' : ''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}${ms % 1000 ? '.' + String(ms % 1000).padStart(3,'0') : ''}`;
};
const show = (selector, visible = true) => $(selector).classList.toggle('hidden', !visible);
function toast(message, error = false) {
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  show('#toast');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => show('#toast', false), error ? 12000 : 4500);
}
async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers: {...options.headers, 'X-CreatorIQ-Token': state.token}});
  let data;
  try { data = await response.json(); } catch { throw new Error('Servern svarade inte med ett giltigt resultat.'); }
  if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'Förfrågan kunde inte slutföras.');
  return data;
}
async function status() {
  const data = await api('/api/status');
  state.token = data.csrf_token;
  state.configured = data.configured;
  show('#youtube-runtime-note', data.youtube_js_runtime === false);
  $('#key-status').textContent = data.configured ? '● API-nyckel tillagd' : '○ Lägg till API-nyckel';
  $('#key-status').classList.toggle('connected', data.configured);
  $('#persist-key').disabled = !data.secure_key_storage;
  $('#persist-key').checked = false;
  $('#storage-note').textContent = data.secure_key_storage
    ? 'Utan kryss sparas nyckeln bara i serverprocessens minne. Med kryss används systemets nyckelhanterare.'
    : 'Ingen säker systemnyckelhanterare hittades. Nyckeln lagras endast i serverprocessens minne och försvinner vid omstart.';
  if (!data.ffmpeg) $('#vision-note').textContent = 'FFmpeg saknas i serverns PATH. Installera det för valfri bildruteanalys. Transkriptanalysen fungerar utan FFmpeg. Bildanalysen använder samplade stillbilder, ingen kontinuerlig videoförståelse.';
}
function modelModalities(model) {
  const labels = {text: 'text', image: 'bild', audio: 'ljud', video: 'video', file: 'fil'};
  const inputs = model.input_modalities || (model.vision ? ['text', 'image'] : ['text']);
  return inputs.map(value => labels[value] || value).join(' + ');
}
function modelKind(model) {
  return model.multimodal || model.vision || model.input_modalities?.some(value => ['image','audio','video'].includes(value))
    ? `MULTIMODAL (${modelModalities(model)})` : 'TEXT';
}
async function loadModels(refresh = true) {
  $('#refresh-models').disabled = true;
  $('#model-info').textContent = 'Kontrollerar aktuella gratismodeller hos OpenRouter…';
  // Restore explicit IDs immediately, including while the catalog is loading/unreachable.
  for (const [selector, storageKey] of [['#model', 'creatoriq.textModel'], ['#vision-model', 'creatoriq.visionModel']]) {
    let saved = '';
    try { saved = localStorage.getItem(storageKey) || ''; } catch { /* Session-only settings still work. */ }
    if (!$(selector).value && saved) {
      $(selector).add(new Option(saved + ' · sparat modellval', saved));
      $(selector).value = saved;
    }
  }
  try {
    const {models} = await api('/api/models' + (refresh ? '?refresh=true' : ''));
    state.models = models;
    for (const [selector, items] of [['#model', models], ['#vision-model', models.filter(m => m.vision)]]) {
      const previous = $(selector).value;
      $(selector).innerHTML = '<option value="">Välj automatiskt från gratisutbudet</option>' + items.map(m => `<option value="${escapeHTML(m.id)}">${escapeHTML(m.name)} · ${escapeHTML(m.id)} · GRATIS · ${escapeHTML(modelKind(m))}</option>`).join('');
      if (previous && !items.some(m => m.id === previous)) {
        const unavailable = new Option(previous + ' · ej tillgänglig som gratis modell', previous);
        unavailable.dataset.unavailable = 'true';
        // Keep it enabled so FormData cannot silently drop the explicit choice.
        $(selector).add(unavailable);
      }
      $(selector).value = previous;
    }
    const visionCount = models.filter(m => m.vision).length;
    const checked = new Date().toLocaleTimeString('sv-SE', {hour:'2-digit', minute:'2-digit', second:'2-digit'});
    $('#model-info').textContent = `${models.length} gratis modeller för textanalys, ${visionCount} med bildstöd. Kontrollerad ${checked}. Priser kontrolleras även före varje AI-anrop.${!visionCount ? ' Ingen kompatibel gratis bildmodell just nu; välj transkriptanalys.' : ''}`;
  } catch (error) { $('#model-info').textContent = error.message; }
  finally { $('#refresh-models').disabled = false; updateModelChoices(); }
}
function unavailableModel() {
  const selectors = ['#model'];
  if ($('input[name=mode]:checked').value !== 'transcript') selectors.push('#vision-model');
  return selectors.map(s => $(s).selectedOptions[0]).find(o => o?.dataset.unavailable === 'true');
}
function updateModelChoices() {
  const unavailable = unavailableModel();
  $('#model-choice-note').textContent = unavailable
    ? `Den valda modellen ${unavailable.value} är inte tillgänglig som kompatibel gratis modell. Välj en annan eller välj automatiskt. Ingen modell har bytts ut.`
    : 'Modellval sparas i den här webbläsaren. En specifikt vald modell ersätts aldrig automatiskt med en annan.';
  $('#model-choice-note').classList.toggle('warning', !!unavailable);
  const selected = state.models.find(model => model.id === $('#model').value);
  $('#model-capabilities').textContent = selected
    ? `Vald modell: ${modelKind(selected)}. Bildruteläget använder endast modeller med bildinmatning; stöd för ljud eller video innebär inte att appen analyserar dem.`
    : $('#model').value ? 'Egenskaper för det sparade modellvalet kunde inte bekräftas i den aktuella listan.'
      : 'MULTIMODAL betyder att modellen även kan ta emot bild, ljud eller video. För bildruteanalys krävs bildstöd.';
  show('#vision-model-field', $('input[name=mode]:checked').value !== 'transcript');
}
async function history() {
  try {
    const data = await api('/api/analyses');
    $('#history').innerHTML = data.analyses.length ? data.analyses.map(a => `<button class="history-item" data-analysis="${escapeHTML(a.id)}"><strong>${escapeHTML(a.title)}</strong><small>${escapeHTML(new Date(a.created_at).toLocaleDateString('sv-SE'))} · ${escapeHTML({done:'Klar',error:'Avbruten',running:'Pågår',queued:'Köad'}[a.status] || a.status)}</small></button>`).join('') : '<p class="subtle">Dina analyser sparas här.</p>';
    $('#mobile-history-list').innerHTML = $('#history').innerHTML;
  } catch (error) { $('#history').textContent = error.message; }
}
function render() {
  const data = state.analysis;
  show('#empty-state', !data);
  if (!data) {
    ['#job-state','#analysis-meta','#mode-tabs','#comparison','#export-actions','#engagement-note'].forEach(s => show(s, false));
    $('#warnings').replaceChildren(); $('#clips').replaceChildren(); return;
  }
  const working = ['queued','running'].includes(data.status);
  show('#job-state', working || data.status === 'error');
  $('#job-state').classList.toggle('error', data.status === 'error');
  $('#job-title').textContent = data.status === 'error' ? 'Analysen kunde inte slutföras' : 'Vi letar efter dina starkaste ögonblick';
  $('#job-progress').textContent = data.error || data.progress;
  $('#analyze').disabled = working;
  $('#analyze').innerHTML = working ? 'Analys pågår…' : 'Hitta mina klipp <span>↗</span>';
  if (data.status === 'error' && !data.transcript) {
    $('#job-progress').textContent += '\nDu kan lägga till SRT/VTT i transkriptfältet och starta en ny analys.';
  }
  show('#analysis-meta', !!data.transcript);
  if (data.transcript) $('#analysis-meta').innerHTML = `<h3>${escapeHTML(data.transcript.title)}</h3><p>${data.transcript.cues.length} tidsatta avsnitt · ${escapeHTML(time(data.transcript.cues.at(-1).end))} · ${escapeHTML(data.transcript.source)}${data.model_id ? '<br>Textmodell: ' + escapeHTML(data.model_id) : ''}</p>`;
  $('#warnings').innerHTML = (data.warnings || []).map(w => `<div class="warning">${escapeHTML(w)}</div>`).join('');
  const results = data.results || [];
  if (!results.some(r => r.mode === state.mode)) state.mode = results[0]?.mode || 'transcript';
  const result = results.find(r => r.mode === state.mode);
  show('#mode-tabs', results.length > 1);
  $('#mode-tabs').innerHTML = results.map(r => `<button data-mode="${escapeHTML(r.mode)}" class="${r.mode === state.mode ? 'active' : ''}">${r.mode === 'transcript' ? 'Transkript' : 'Transkript + bildrutor'} · ${r.clips.length}</button>`).join('');
  show('#comparison', results.length > 1);
  $('#comparison').innerHTML = results.length > 1 ? results.map(r => `<div><h3>${r.mode === 'transcript' ? 'RANKNING / TRANSKRIPT' : 'RANKNING / MED BILDRUTOR'}</h3><ol>${r.clips.map(c => `<li>${escapeHTML(c.hook)}</li>`).join('')}</ol></div>`).join('') : '';
  show('#export-actions', data.status === 'done');
  show('#engagement-note', !!result?.clips.length);
  $('#clips').innerHTML = result ? `<p class="field-help">${escapeHTML(result.method)}<br>Textmodell: ${escapeHTML(result.model)}${result.vision_model ? ' · Bildmodell: ' + escapeHTML(result.vision_model) : ''}</p>` + (result.clips.length ? result.clips.map((clip, index) => card(clip, index, data.status === 'done')).join('') : '<div class="notice">Inga relevanta klipp hittades. Prova en annan brief eller modell.</div>') : '';
}
function card(c, index, editable) {
  let link = '';
  if (state.analysis.request.youtube_url) {
    try {
      const url = new URL(state.analysis.request.youtube_url);
      const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/')[2];
      if (/^[\w-]{11}$/.test(videoId || '')) link = `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(c.start)}s`;
    } catch { /* No external link for malformed URLs. */ }
  }
  return `<article class="clip-card ${escapeHTML(c.status)}" data-clip="${escapeHTML(c.id)}">
    <div class="clip-top"><span class="rank">${String(index+1).padStart(2,'0')}</span><span class="clip-topic">${escapeHTML(c.topic)}</span><span class="score" title="Subjektiv AI-bedömning av engagemang">${c.engagement}<small>/ 100 AI</small></span></div>
    <div class="clip-body"><h3>${escapeHTML(c.hook)}</h3><div class="time-strip">${link ? `<a href="${escapeHTML(link)}" target="_blank" rel="noreferrer">${time(c.start)} ↗</a>` : `<span>${time(c.start)}</span>`}<span>→</span><span>${time(c.end)}</span><span>${c.duration.toFixed(1)} sek${c.adjusted ? ' · justerat' : ''}</span></div>
    <p class="clip-description">${escapeHTML(c.description)}</p><div class="clip-reason"><b>VARFÖR DET HÄR KLIPPET</b>${escapeHTML(c.reason)}</div><div class="dialogue"><div><span>ÖPPNING / TRANSKRIPT</span><p>“${escapeHTML(c.opening_dialogue)}”</p></div><div><span>AVSLUTNING / TRANSKRIPT</span><p>“${escapeHTML(c.closing_dialogue)}”</p></div></div>
    <details><summary>AI-bedömning & visuell kontext <span>＋</span></summary><p>${escapeHTML(c.engagement_reason)}</p>${c.visual_context ? `<p><strong>Samplade stillbilder:</strong> ${escapeHTML(c.visual_context)}</p>` : state.mode === 'multimodal' ? '<p>Ingen bildobservation för den här tidsperioden. Bedömningen utgår från transkriptet.</p>' : ''}</details>
    ${c.adjusted ? '<p class="field-help">Gränserna är manuellt ändrade. AI-poäng och motivering gäller originalförslaget.</p>' : ''}
    ${c.boundary_warning ? `<div class="warning">${escapeHTML(c.boundary_warning)}</div>` : ''}</div>
    <div class="clip-actions"><button data-action="select" class="${c.status === 'selected' ? 'active' : ''}" ${!editable ? 'disabled' : ''}>${c.status === 'selected' ? '✓ Vald' : '＋ Välj klipp'}</button><button data-action="reject" class="${c.status === 'rejected' ? 'active' : ''}" ${!editable ? 'disabled' : ''}>${c.status === 'rejected' ? '↶ Ångra' : 'Avvisa'}</button><button data-action="edit" ${!editable ? 'disabled' : ''}>Justera ↗</button></div></article>`;
}
async function loadAnalysis(id) {
  clearTimeout(state.poll);
  try {
    const data = await api('/api/analyses/' + encodeURIComponent(id));
    state.analysis = data;
    localStorage.setItem('creatoriq.lastAnalysis', id);
    render();
    if (['queued','running'].includes(data.status)) state.poll = setTimeout(() => loadAnalysis(id), 1400);
    else history();
  } catch (error) { toast(error.message, true); $('#analyze').disabled = false; }
}
$('#analysis-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (unavailableModel()) { toast('Den valda modellen är inte tillgänglig. Välj en annan gratis modell eller automatiskt modellval.', true); return; }
  if (!state.configured) { $('#settings-dialog').showModal(); toast('Lägg först till din OpenRouter API-nyckel.'); return; }
  const button = $('#analyze'); button.disabled = true;
  try {
    const form = new FormData(event.target);
    for (const key of ['model_id','vision_model_id']) if (!form.get(key)) form.delete(key);
    const data = await api('/api/analyses', {method:'POST', body:form});
    state.mode = 'transcript';
    await loadAnalysis(data.id); history();
    if (window.innerWidth < 950) $('.results-section').scrollIntoView({behavior:'smooth'});
  } catch (error) { toast(error.message, true); button.disabled = false; }
});
$('#key-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.target.querySelector('[type=submit]'); button.disabled = true;
  try {
    await api('/api/key', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({key:$('#api-key').value, persist:$('#persist-key').checked})});
    $('#api-key').value = ''; $('#settings-dialog').close(); await status(); toast('API-nyckeln är tillagd.');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$('#delete-key').addEventListener('click', async () => {
  try { const result = await api('/api/key', {method:'DELETE'}); $('#api-key').value = ''; await status(); toast(result.environment_key ? 'Den lokala nyckeln är borttagen. Miljövariabeln är fortfarande aktiv.' : 'API-nyckeln är borttagen.'); }
  catch (error) { toast(error.message, true); }
});
for (const selector of ['#key-status','#open-settings']) $(selector).addEventListener('click', () => $('#settings-dialog').showModal());
for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
$('#settings-dialog').addEventListener('close', () => { $('#api-key').value = ''; });
$('#refresh-models').addEventListener('click', () => loadModels(true));
for (const [selector, storageKey] of [['#model', 'creatoriq.textModel'], ['#vision-model', 'creatoriq.visionModel']]) {
  $(selector).addEventListener('change', () => {
    try {
      if ($(selector).value) localStorage.setItem(storageKey, $(selector).value);
      else localStorage.removeItem(storageKey);
    } catch { toast('Modellvalet gäller den här sidan; webbläsaren tillåter inte att det sparas.'); }
    updateModelChoices();
  });
}
$('#refresh-history').addEventListener('click', history);
for (const selector of ['#history','#mobile-history-list']) $(selector).addEventListener('click', event => { const button = event.target.closest('[data-analysis]'); if (button) { $('#history-dialog').close(); loadAnalysis(button.dataset.analysis); } });
$('#open-history').addEventListener('click', () => { history(); $('#history-dialog').showModal(); });
$('#new-analysis').addEventListener('click', () => {
  clearTimeout(state.poll); state.analysis = null; render(); $('#analyze').disabled = false;
  $('#analyze').innerHTML = 'Hitta mina klipp <span>↗</span>';
  localStorage.removeItem('creatoriq.lastAnalysis'); $('#youtube-url').focus();
});
for (const button of document.querySelectorAll('[data-prompt]')) button.addEventListener('click', () => { $('#instructions').value = button.dataset.prompt; $('#instructions').focus(); });
for (const radio of document.querySelectorAll('input[name=mode]')) radio.addEventListener('change', () => { show('#vision-note', radio.value !== 'transcript'); updateModelChoices(); });
$('#transcript-file').addEventListener('change', event => { $('#file-info').textContent = event.target.files[0] ? 'Filen används före inklistrad text och automatisk hämtning.' : ''; });
$('#load-example').addEventListener('click', async () => {
  try {
    const response = await fetch('/static/example.vtt');
    if (!response.ok) throw new Error('Exemplet kunde inte läsas.');
    $('#transcript-text').value = await response.text(); $('#transcript-file').value = ''; $('#file-info').textContent = '';
    if (!$('#instructions').value) $('#instructions').value = 'Hitta självbärande, användbara insikter om kreativitet och att bygga en publik. Behåll hela resonemang och konkreta exempel.';
    toast('Exempeltranskript inläst. AI-analysen använder fortfarande OpenRouter.');
  } catch (error) { toast(error.message, true); }
});
$('#mode-tabs').addEventListener('click', event => { const button = event.target.closest('[data-mode]'); if (button) { state.mode = button.dataset.mode; render(); } });
$('#clips').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const clipId = button.closest('[data-clip]').dataset.clip;
  const clip = state.analysis.results.find(r => r.mode === state.mode).clips.find(c => c.id === clipId);
  if (button.dataset.action === 'edit') { openEditor(clip); return; }
  const nextStatus = button.dataset.action === 'select' ? (clip.status === 'selected' ? 'suggested' : 'selected') : (clip.status === 'rejected' ? 'suggested' : 'rejected');
  button.disabled = true;
  try { await editClip(clipId, {status:nextStatus}); } catch (error) { toast(error.message, true); button.disabled = false; }
});
async function editClip(id, edit) {
  state.analysis = await api(`/api/analyses/${state.analysis.id}/clips/${state.mode}/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify(edit)});
  render();
}
function openEditor(clip) {
  state.editing = clip.id;
  const cues = state.analysis.transcript.cues;
  const options = cues.map(c => `<option value="${escapeHTML(c.id)}">${time(c.start)} – ${time(c.end)} · ${escapeHTML(c.text.slice(0,130))}</option>`).join('');
  $('#edit-start').innerHTML = options; $('#edit-end').innerHTML = options;
  $('#edit-start').value = clip.start_cue_id; $('#edit-end').value = clip.end_cue_id;
  updateEditDuration(); $('#edit-dialog').showModal();
}
function updateEditDuration() {
  const cues = state.analysis.transcript.cues;
  const a = cues.find(c => c.id === $('#edit-start').value), b = cues.find(c => c.id === $('#edit-end').value);
  $('#edit-duration').textContent = a && b ? `${time(a.start)} → ${time(b.end)} · ${(b.end - a.start).toFixed(3)} sekunder` : '';
}
$('#edit-start').addEventListener('change', updateEditDuration); $('#edit-end').addEventListener('change', updateEditDuration);
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault();
  try { await editClip(state.editing, {start_cue_id:$('#edit-start').value, end_cue_id:$('#edit-end').value}); $('#edit-dialog').close(); toast('Klippgränserna är sparade.'); }
  catch (error) { toast(error.message, true); }
});
for (const [selector, selected] of [['#export-all',false],['#export-selected',true]]) $(selector).addEventListener('click', () => {
  if (state.analysis) window.location.assign(`/api/analyses/${state.analysis.id}/export?selected_only=${selected}`);
});
async function init() {
  try { await status(); } catch (error) { toast('Servern kunde inte nås: ' + error.message, true); }
  history(); loadModels(true);
  const last = localStorage.getItem('creatoriq.lastAnalysis'); if (last) loadAnalysis(last);
}
init();
