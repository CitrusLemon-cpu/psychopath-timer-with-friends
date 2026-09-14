const storageKey = 'psychopath-timer-state';
const state = JSON.parse(localStorage.getItem(storageKey) || '{"people":[],"timers":[]}');
const $ = (selector) => document.querySelector(selector);
const timerList = $('#timer-list');
const emptyState = $('#empty-state');
const dialog = $('#timer-dialog');
const formatDate = (value) => new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const duration = (seconds) => { const safe = Math.max(0, Math.floor(seconds)); const h = Math.floor(safe / 3600); const m = Math.floor((safe % 3600) / 60); const s = safe % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; };
const save = () => localStorage.setItem(storageKey, JSON.stringify(state));
const escape = (value) => { const div = document.createElement('div'); div.textContent = value; return div.innerHTML; };
function renderPeople() {
  $('#crew-count').textContent = String(state.people.length).padStart(2, '0');
  $('#people-list').innerHTML = state.people.length ? state.people.map((person) => `<div class="person"><span>${escape(person.name)}</span><button class="remove-person" data-remove-person="${person.id}">REMOVE</button></div>`).join('') : '<p class="aside-note">No crew registered. Add someone below.</p>';
  $('#crew-picker').innerHTML = state.people.length ? state.people.map((person) => `<label class="crew-option"><input type="checkbox" name="crew" value="${person.id}"><span>${escape(person.name)}</span></label>`).join('') : '<p class="aside-note">Add crew members before deploying a timer.</p>';
}
function renderTimers() {
  const now = Date.now(); let active = 0;
  timerList.innerHTML = state.timers.map((timer) => {
    const start = new Date(timer.start).getTime(); const end = new Date(timer.end).getTime(); const total = end - start; const effectiveNow = timer.pausedAt || now; const elapsed = Math.min(total, Math.max(0, effectiveNow - start));
    const complete = now >= end; const standby = now < start; if (!complete && !standby) active += 1;
    const status = complete ? 'COMPLETE' : standby ? 'STANDBY' : timer.paused ? 'PAUSED' : 'IN PROGRESS';
    const percent = complete ? 100 : Math.round((elapsed / total) * 100); const remaining = complete ? 0 : standby ? (start - now) / 1000 : (end - now) / 1000;
    const crew = timer.people.map((id) => state.people.find((person) => person.id === id)?.name).filter(Boolean).join(' · ') || 'UNASSIGNED CREW';
    return `<article class="timer-card ${complete ? 'complete' : timer.paused ? 'paused' : ''}"><div class="timer-top"><div><div class="timer-title">${escape(timer.name)}</div><div class="timer-crew">${escape(crew)}</div></div><span class="status">${status}</span></div><div class="progress-row"><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><span class="time-left">${duration(remaining)}</span></div><div class="timer-bottom"><span>${formatDate(timer.start)} → ${formatDate(timer.end)}</span><div class="timer-actions">${!complete && !standby ? `<button data-toggle="${timer.id}">${timer.paused ? 'RESUME' : 'PAUSE'}</button>` : ''}<button data-delete="${timer.id}">DELETE</button></div></div></article>`;
  }).join('');
  emptyState.classList.toggle('hidden', state.timers.length > 0); $('#active-count').textContent = String(active).padStart(2, '0');
}
function render() { renderPeople(); renderTimers(); }
$('#person-form').addEventListener('submit', (event) => { event.preventDefault(); const input = $('#person-name'); const name = input.value.trim(); if (!name) return; state.people.push({ id: crypto.randomUUID(), name }); input.value = ''; save(); render(); });
$('#people-list').addEventListener('click', (event) => { const button = event.target.closest('[data-remove-person]'); if (!button) return; state.people = state.people.filter((person) => person.id !== button.dataset.removePerson); state.timers.forEach((timer) => { timer.people = timer.people.filter((id) => id !== button.dataset.removePerson); }); save(); render(); });
function openDialog() { renderPeople(); $('#timer-form').reset(); dialog.showModal(); }
$('#open-timer').addEventListener('click', openDialog); $('#empty-add').addEventListener('click', openDialog); $('#close-dialog').addEventListener('click', () => dialog.close()); $('#cancel-dialog').addEventListener('click', () => dialog.close());
$('#timer-form').addEventListener('submit', (event) => { event.preventDefault(); const end = new Date($('#timer-end').value); const startValue = $('#timer-start').value; const start = startValue ? new Date(startValue) : new Date(); if (end <= start) return alert('End time must be after the start time.'); state.timers.push({ id: crypto.randomUUID(), name: $('#timer-name').value.trim(), start: start.toISOString(), end: end.toISOString(), people: [...document.querySelectorAll('input[name="crew"]:checked')].map((input) => input.value), paused: false }); save(); render(); dialog.close(); });
timerList.addEventListener('click', (event) => { const toggle = event.target.closest('[data-toggle]'); const remove = event.target.closest('[data-delete]'); if (toggle) { const timer = state.timers.find((item) => item.id === toggle.dataset.toggle); if (timer.paused) { const pausedDuration = Date.now() - timer.pausedAt; timer.start = new Date(new Date(timer.start).getTime() + pausedDuration).toISOString(); timer.end = new Date(new Date(timer.end).getTime() + pausedDuration).toISOString(); delete timer.pausedAt; timer.paused = false; } else { timer.pausedAt = Date.now(); timer.paused = true; } save(); render(); } if (remove) { state.timers = state.timers.filter((item) => item.id !== remove.dataset.delete); save(); render(); } });
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString([], { hour12: false }); renderTimers(); }, 1000); render();
