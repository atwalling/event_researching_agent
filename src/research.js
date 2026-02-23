const fs = require('fs/promises');
const path = require('path');

const CSV_HEADER = 'Event Title,Date,Time,City,Venue/Location,Cost,Direct URL';
const TOP_SPORTS = ['Running', 'Football', 'Basketball', 'Soccer', 'Baseball'];
const DEFAULT_RESEARCH_MODEL = 'o4-mini-deep-research-2025-06-26';
const DEFAULT_VALIDATION_MODEL = 'gpt-5-mini';

function log(level, message, context = {}) {
  const payload = {
    ts: new Date().toISOString(),
    level,
    message,
    ...context
  };
  const line = JSON.stringify(payload);
  if (level === 'error') {
    console.error(line);
    return;
  }
  console.log(line);
}

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
  if (!apiKey) {
    log('warn', 'OPENAI_API_KEY is not configured; OpenAI call skipped');
    return null;
  }

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      background: false,
      stream: false,
      input: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ]
    })
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(`OpenAI request failed: ${res.status} ${details}`);
  }
  const data = await res.json();
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text;
  }
  if (Array.isArray(data.output)) {
    const text = data.output
      .flatMap((item) => item.content || [])
      .filter((content) => content.type === 'output_text')
      .map((content) => content.text || '')
      .join('\n')
      .trim();
    return text;
  }
  return '';
}

function normalizeBucket(events) {
  if (!Array.isArray(events)) return [];
  return events.map(normalize).filter(Boolean);
}

function parseRawResearchOutput(raw) {
  const parsed = JSON.parse(raw);
  return {
    joinable: normalizeBucket(parsed.joinable),
    watchable: normalizeBucket(parsed.watchable)
  };
}

async function runValidationAgent({ raw, validationModel, chunk, sport }) {
  if (!process.env.OPENAI_API_KEY) {
    return parseRawResearchOutput(raw);
  }

  const systemPrompt = [
    'You are a validation agent for sports event research output.',
    'Return strict JSON only with shape {"joinable": [], "watchable": []}.',
    'Drop entries that are not real events or have missing required fields.',
    'Required fields for every event: title,date,time,city,venue,cost,url.',
    'Never include markdown fences or commentary.'
  ].join(' ');

  const userPrompt = [
    `Sport: ${sport}`,
    `Chunk agent: ${chunk.agentId} (${chunk.from} -> ${chunk.to})`,
    'Validate and sanitize the following JSON payload:',
    raw
  ].join('\n');

  const validatedRaw = await callOpenAI(validationModel, systemPrompt, userPrompt);
  if (!validatedRaw) {
    throw new Error('Validation agent returned empty output');
  }

  return parseRawResearchOutput(validatedRaw);
}

async function callGemini(agent, userPrompt) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    log('warn', 'GOOGLE_API_KEY is not configured; Gemini call skipped');
    return null;
  }

  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: userPrompt,
      agent,
      background: true
    })
  });

  if (!res.ok) {
    const details = await res.text();
    throw new Error(`Google request failed: ${res.status} ${details}`);
  }
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
  const validated = {
    city: String(params.city || '').trim(),
    centerpoint: String(params.centerpoint || '').trim(),
    radiusMiles: Number(params.radiusMiles),
    sport: String(params.sport || '').trim(),
    timeframeMonths: Number(params.timeframeMonths || 1),
    agentCount: Number(params.agentCount || 1),
    includeJoinable: Boolean(params.includeJoinable),
    includeWatchable: Boolean(params.includeWatchable),
    researchModel: params.researchModel || DEFAULT_RESEARCH_MODEL,
    validationModel: params.validationModel || DEFAULT_VALIDATION_MODEL
  };

  if (!validated.city) throw new Error('city is required');
  if (!validated.centerpoint) throw new Error('centerpoint is required');
  if (!validated.sport) throw new Error('sport is required');
  if (!Number.isFinite(validated.radiusMiles) || validated.radiusMiles <= 0) throw new Error('radiusMiles must be > 0');
  if (!Number.isInteger(validated.timeframeMonths) || validated.timeframeMonths < 1) throw new Error('timeframeMonths must be an integer >= 1');
  if (!Number.isInteger(validated.agentCount) || validated.agentCount < 1) throw new Error('agentCount must be an integer >= 1');
  if (!validated.includeJoinable && !validated.includeWatchable) throw new Error('Select at least one of Joinable or Watchable');

  log('info', 'Starting research run', {
    sport: validated.sport,
    model: validated.researchModel,
    agentCount: validated.agentCount,
    timeframeMonths: validated.timeframeMonths
  });

  const now = new Date();
  const end = new Date(now);
  end.setMonth(end.getMonth() + validated.timeframeMonths);

  const existing = await loadExistingEvents(validated.sport);
  const chunks = splitIntoChunks(now, end, validated.agentCount);
  const systemPrompt = buildSystemPrompt(validated);

  const combined = { joinable: [], watchable: [] };
  const errors = [];
  const flow = [];

  for (const chunk of chunks) {
    const prompt = buildChunkPrompt(validated, chunk, existing);
    let raw = '';

    try {
      if (validated.researchModel === 'deep-research-pro-preview-12-2025') {
        raw = await callGemini(validated.researchModel, prompt);
      } else {
        raw = await callOpenAI(validated.researchModel, systemPrompt, prompt);
      }
    } catch (error) {
      const msg = `Chunk ${chunk.agentId} provider request failed: ${error.message}`;
      log('error', msg);
      errors.push(msg);
      continue;
    }

    if (!raw) {
      log('warn', 'Chunk produced empty output', { agentId: chunk.agentId });
      flow.push({
        agentId: chunk.agentId,
        chunk,
        researchModel: validated.researchModel,
        validationModel: validated.validationModel,
        status: 'empty',
        joinableCount: 0,
        watchableCount: 0,
        notes: 'Research model returned empty output'
      });
      continue;
    }

    try {
      const sanitized = await runValidationAgent({
        raw,
        validationModel: validated.validationModel,
        chunk,
        sport: validated.sport
      });
      combined.joinable.push(...sanitized.joinable);
      combined.watchable.push(...sanitized.watchable);
      flow.push({
        agentId: chunk.agentId,
        chunk,
        researchModel: validated.researchModel,
        validationModel: validated.validationModel,
        status: 'validated',
        joinableCount: sanitized.joinable.length,
        watchableCount: sanitized.watchable.length,
        notes: 'Validation agent accepted/sanitized output'
      });
    } catch (error) {
      const msg = `Chunk ${chunk.agentId} failed validation JSON parsing: ${error.message}`;
      log('error', msg, { preview: raw.slice(0, 500) });
      errors.push(msg);
      flow.push({
        agentId: chunk.agentId,
        chunk,
        researchModel: validated.researchModel,
        validationModel: validated.validationModel,
        status: 'validation_failed',
        joinableCount: 0,
        watchableCount: 0,
        notes: msg
      });
    }
  }

  const joinable = uniqueByTitleDate(combined.joinable.map(normalize).filter(Boolean), existing);
  const watchable = uniqueByTitleDate(combined.watchable.map(normalize).filter(Boolean), existing);

  const csv = toCsv(joinable, watchable);
  const dataDir = path.join(process.cwd(), 'data');
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(path.join(dataDir, `${validated.sport.toLowerCase()}.csv`), csv, 'utf8');

  log('info', 'Research run complete', {
    joinableCount: joinable.length,
    watchableCount: watchable.length,
    errorCount: errors.length
  });

  return {
    meta: {
      stream: false,
      background: false,
      chunks,
      flow,
      existingCount: existing.length,
      errors
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
  splitIntoChunks,
  DEFAULT_RESEARCH_MODEL,
  DEFAULT_VALIDATION_MODEL
};
