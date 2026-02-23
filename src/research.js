const fs = require('fs/promises');
const path = require('path');

const CSV_HEADER = 'Event Title,Date,Time,City,Venue/Location,Cost,Direct URL';
const TOP_SPORTS = ['Running', 'Football', 'Basketball', 'Soccer', 'Baseball'];

function toISODate(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function splitIntoChunks(startDate, endDate, agentCount) {
  const chunks = [];
  const totalMs = endDate.getTime() - startDate.getTime();
  const sizeMs = Math.floor(totalMs / agentCount);

  for (let i = 0; i < agentCount; i += 1) {
    const chunkStart = new Date(startDate.getTime() + i * sizeMs);
    const chunkEnd = i === agentCount - 1 ? new Date(endDate) : new Date(startDate.getTime() + (i + 1) * sizeMs);
    chunks.push({
      agentId: i + 1,
      from: toISODate(chunkStart),
      to: toISODate(chunkEnd)
    });
  }

  return chunks;
}

function parseCsvRows(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line !== CSV_HEADER)
    .map((line) => {
      const [title, date, time, city, venue, cost, url] = line.split(',');
      return {
        title: title?.trim(),
        date: date?.trim(),
        time: time?.trim(),
        city: city?.trim(),
        venue: venue?.trim(),
        cost: cost?.trim(),
        url: url?.trim()
      };
    })
    .filter((r) => r.title && r.date);
}

async function loadExistingEvents(sport) {
  const filePath = path.join(process.cwd(), 'data', `${sport.toLowerCase()}.csv`);
  try {
    const csv = await fs.readFile(filePath, 'utf8');
    return parseCsvRows(csv);
  } catch {
    return [];
  }
}

function buildSystemPrompt({ city, centerpoint, radiusMiles, sport, includeJoinable, includeWatchable }) {
  const groups = [includeJoinable ? 'Joinable' : null, includeWatchable ? 'Watchable' : null].filter(Boolean).join(' and ');
  return `Given a city, centerpoint, radius (miles), sport, and time window, return local ${groups} sporting events. Output only CSV rows with header: ${CSV_HEADER}. Classify Joinable vs Watchable by event details. Avoid reseller links and hallucinations.`
    + ` Variables: city=${city}; centerpoint=${centerpoint}; radius=${radiusMiles}; sport=${sport}.`;
}

function buildChunkPrompt(params, chunk, existingRows) {
  const existing = existingRows.map((e) => `${e.title} (${e.date})`).join('; ');
  return [
    `City: ${params.city}`,
    `Centerpoint: ${params.centerpoint}`,
    `Radius miles: ${params.radiusMiles}`,
    `Sport: ${params.sport}`,
    `Window: ${chunk.from} to ${chunk.to}`,
    `Return groups: ${params.includeJoinable ? 'Joinable ' : ''}${params.includeWatchable ? 'Watchable' : ''}`.trim(),
    'Output format: JSON with {joinable: [], watchable: []}; each event has title,date,time,city,venue,cost,url.',
    `DO NOT REPEAT: ${existing || 'none'}`
  ].join('\n');
}

async function callOpenAI(model, systemPrompt, userPrompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      background: true,
      stream: true,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status}`);
  const data = await res.json();
  return data.output_text || '';
}

async function callGemini(agent, userPrompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: userPrompt,
      agent,
      background: true
    })
  });

  if (!res.ok) throw new Error(`Google request failed: ${res.status}`);
  const data = await res.json();
  return data?.outputs?.at(-1)?.text || '';
}

function normalize(event) {
  const cleaned = {
    title: (event.title || '').trim(),
    date: (event.date || '').trim(),
    time: (event.time || '').trim(),
    city: (event.city || '').trim(),
    venue: (event.venue || '').trim(),
    cost: (event.cost || '').trim(),
    url: (event.url || '').trim()
  };
  return Object.values(cleaned).every(Boolean) ? cleaned : null;
}

function uniqueByTitleDate(events, existing) {
  const seen = new Set(existing.map((e) => `${e.title}|${e.date}`.toLowerCase()));
  const out = [];
  for (const event of events) {
    const key = `${event.title}|${event.date}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(event);
  }
  return out;
}

function toCsv(joinable, watchable) {
  const joinableRows = joinable.map((e) => `${e.title},${e.date},${e.time},${e.city},${e.venue},${e.cost},${e.url}`);
  const watchableRows = watchable.map((e) => `${e.title},${e.date},${e.time},${e.city},${e.venue},${e.cost},${e.url}`);
  return [
    'Joinable',
    CSV_HEADER,
    ...joinableRows,
    '',
    'Watchable',
    CSV_HEADER,
    ...watchableRows,
    ''
  ].join('\n');
}

async function runResearch(params) {
  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + Number(params.timeframeMonths || 1));

  const existing = await loadExistingEvents(params.sport);
  const chunks = splitIntoChunks(now, end, Number(params.agentCount || 1));
  const systemPrompt = buildSystemPrompt(params);

  const combined = { joinable: [], watchable: [] };

  for (const chunk of chunks) {
    const prompt = buildChunkPrompt(params, chunk, existing);
    let raw = '';

    if (params.researchModel === 'deep-research-pro-preview-12-2025') {
      raw = await callGemini(params.researchModel, prompt);
    } else {
      raw = await callOpenAI(params.researchModel, systemPrompt, prompt);
    }

    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      combined.joinable.push(...(parsed.joinable || []));
      combined.watchable.push(...(parsed.watchable || []));
    } catch {
      // Ignore unparseable chunks; validation layer can retry.
    }
  }

  const joinable = uniqueByTitleDate(combined.joinable.map(normalize).filter(Boolean), existing);
  const watchable = uniqueByTitleDate(combined.watchable.map(normalize).filter(Boolean), existing);

  const csv = toCsv(joinable, watchable);
  await fs.writeFile(path.join(process.cwd(), 'data', `${params.sport.toLowerCase()}.csv`), csv, 'utf8');

  return {
    meta: {
      stream: true,
      background: true,
      chunks,
      existingCount: existing.length
    },
    joinable,
    watchable,
    csv,
    topSports: TOP_SPORTS
  };
}

module.exports = {
  CSV_HEADER,
  TOP_SPORTS,
  runResearch,
  splitIntoChunks
};
