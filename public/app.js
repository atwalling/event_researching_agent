async function loadConfig() {
  const res = await fetch('/api/config');
  const data = await res.json();

  const sportSelect = document.getElementById('sport-select');
  data.topSports.forEach((sport) => {
    const opt = document.createElement('option');
    opt.value = sport;
    opt.textContent = sport;
    sportSelect.appendChild(opt);
  });

  const modelSelect = document.getElementById('model-select');
  data.providers.forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    modelSelect.appendChild(opt);
  });
  modelSelect.value = data.defaultResearchModel;

  const validationSelect = document.getElementById('validation-model-select');
  data.validationModels.forEach((model) => {
    const opt = document.createElement('option');
    opt.value = model;
    opt.textContent = model;
    validationSelect.appendChild(opt);
  });
  validationSelect.value = data.defaultValidationModel;
}

function card(event, bucket) {
  return `<article class="card"><h3>${event.title}</h3><p><strong>Type:</strong> ${bucket}</p><p>${event.date} · ${event.time}</p><p>${event.city} · ${event.venue}</p><p><strong>Price:</strong> ${event.cost}</p><a href="${event.url}" target="_blank">Source</a></article>`;
}

document.getElementById('research-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = new FormData(e.target);
  const payload = Object.fromEntries(form.entries());
  payload.includeJoinable = form.get('includeJoinable') === 'on';
  payload.includeWatchable = form.get('includeWatchable') === 'on';

  const res = await fetch('/api/research', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await res.json();
  document.getElementById('flow-output').textContent = JSON.stringify(data.meta?.flow || [], null, 2);
  document.getElementById('csv-output').textContent = data.csv || data.error;

  const cards = [];
  (data.joinable || []).forEach((ev) => cards.push(card(ev, 'Joinable')));
  (data.watchable || []).forEach((ev) => cards.push(card(ev, 'Watchable')));
  document.getElementById('cards').innerHTML = cards.join('');
});

loadConfig();
