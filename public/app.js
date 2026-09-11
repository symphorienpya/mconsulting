const modal = document.querySelector('#request-modal');
const form = document.querySelector('#request-form');
const feed = document.querySelector('#request-feed');
const toast = document.querySelector('#toast');
const formatter = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });

function relativeTime(value) {
  const seconds = Math.round((new Date(value).getTime() - Date.now()) / 1000);
  const divisions = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day']];
  let duration = seconds;
  for (const [amount, unit] of divisions) {
    if (Math.abs(duration) < amount) return formatter.format(Math.round(duration), unit);
    duration /= amount;
  }
  return formatter.format(Math.round(duration), 'week');
}

document.querySelectorAll('[data-time]').forEach((time) => { time.textContent = relativeTime(time.dataset.time); });
document.querySelectorAll('.open-request').forEach((button) => button.addEventListener('click', () => modal.showModal()));
document.querySelector('.close-modal').addEventListener('click', () => modal.close());
modal.addEventListener('click', (event) => { if (event.target === modal) modal.close(); });

function requestRow(request) {
  const initials = request.name.split(' ').map((part) => part[0]).slice(0, 2).join('');
  return `<div class="request-row new-row" data-request-id="${escapeHtml(request.id)}"><div class="request-icon">${escapeHtml(initials)}</div><div class="request-detail"><strong>${escapeHtml(request.name)} <small>${escapeHtml(request.company || 'Independent')}</small></strong><span>${escapeHtml(request.service)} · ${escapeHtml(request.budget || 'To discuss')}</span></div><div class="request-state"><b>${escapeHtml(request.status)}</b><time>${relativeTime(request.created_at)}</time></div></div>`;
}

function escapeHtml(value) {
  const div = document.createElement('div');
  div.textContent = value || '';
  return div.innerHTML;
}

function errorMessage(error) {
  if (typeof error === 'string') return error;
  if (error?.message) return error.message;
  if (error?.details) return `${error.message || 'Database error'} ${error.details}`;
  return 'Une erreur est survenue. Veuillez réessayer.';
}

function replaceRequest(request) {
  const row = feed.querySelector(`[data-request-id="${CSS.escape(request.id)}"]`);
  if (row) row.outerHTML = requestRow(request);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = form.querySelector('button');
  const message = document.querySelector('#form-message');
  button.disabled = true; button.innerHTML = 'Sending...';
  try {
    const response = await fetch('/api/requests', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result = await response.json();
    if (!response.ok) throw new Error(errorMessage(result.error));
    form.reset(); message.textContent = 'Demande reçue. Nous vous contacterons rapidement.'; message.className = 'form-message success';
    feed.insertAdjacentHTML('afterbegin', requestRow(result.request));
    setTimeout(() => { modal.close(); message.textContent = ''; message.className = 'form-message'; }, 1800);
  } catch (error) { message.textContent = errorMessage(error); message.className = 'form-message error'; }
  button.disabled = false; button.innerHTML = 'Envoyer la demande <span>↗</span>';
});

const config = window.MCONSULTING_CONFIG;
if (document.body.dataset.supabase === 'true' && config.supabaseUrl && config.supabaseKey && window.supabase) {
  const client = window.supabase.createClient(config.supabaseUrl, config.supabaseKey);
  client.channel('requests-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'requests' }, (payload) => {
      if (!document.querySelector(`[data-request-id="${CSS.escape(payload.new.id)}"]`)) feed.insertAdjacentHTML('afterbegin', requestRow(payload.new));
      toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 4500);
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'requests' }, (payload) => {
      replaceRequest(payload.new);
    })
    .subscribe();
} else {
  setInterval(async () => {
    const response = await fetch('/api/requests');
    if (!response.ok) return;
    const result = await response.json();
    result.requests?.forEach((request) => {
      if (feed.querySelector(`[data-request-id="${CSS.escape(request.id)}"]`)) replaceRequest(request);
      else feed.insertAdjacentHTML('afterbegin', requestRow(request));
    });
  }, 3000);
}
