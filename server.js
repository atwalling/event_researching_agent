const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { runResearch, TOP_SPORTS, DEFAULT_RESEARCH_MODEL, DEFAULT_VALIDATION_MODEL } = require('./src/research');


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

function loadDotEnvFile(filePath) {
  if (!fsSync.existsSync(filePath)) return;
  const lines = fsSync.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    if (!key || process.env[key] !== undefined) continue;

    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('\"') && value.endsWith('\"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

loadDotEnvFile(path.join(__dirname, '.env'));

const PORT = process.env.PORT || 3000;

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function serveStatic(res, filePath, contentType) {
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  log('info', 'incoming request', { method: req.method, url: req.url });

  if (req.method === 'GET' && req.url === '/api/config') {
    sendJson(res, 200, {
      topSports: TOP_SPORTS,
      providers: ['web-search-3-fast', 'deep-research-pro-preview-12-2025', DEFAULT_RESEARCH_MODEL],
      defaultResearchModel: DEFAULT_RESEARCH_MODEL,
      validationModels: [DEFAULT_VALIDATION_MODEL],
      defaultValidationModel: DEFAULT_VALIDATION_MODEL
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/research') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body || '{}');
        const results = await runResearch({
          city: params.city,
          centerpoint: params.centerpoint,
          radiusMiles: Number(params.radiusMiles),
          sport: params.sport,
          timeframeMonths: Number(params.timeframeMonths),
          agentCount: Number(params.agentCount),
          includeJoinable: Boolean(params.includeJoinable),
          includeWatchable: Boolean(params.includeWatchable),
          researchModel: params.researchModel || DEFAULT_RESEARCH_MODEL,
          validationModel: params.validationModel || DEFAULT_VALIDATION_MODEL
        });
        sendJson(res, 200, results);
      } catch (error) {
        log('error', 'research request failed', { error: error.message });
        sendJson(res, 400, { error: error.message });
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    await serveStatic(res, path.join(__dirname, 'public', 'index.html'), 'text/html');
    return;
  }

  if (req.method === 'GET' && req.url === '/app.js') {
    await serveStatic(res, path.join(__dirname, 'public', 'app.js'), 'application/javascript');
    return;
  }

  if (req.method === 'GET' && req.url === '/styles.css') {
    await serveStatic(res, path.join(__dirname, 'public', 'styles.css'), 'text/css');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log('Codespaces quick start: npm start');
});
