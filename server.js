const http = require('http');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { runResearch, TOP_SPORTS, DEFAULT_RESEARCH_MODEL, DEFAULT_VALIDATION_MODEL } = require('./src/research');

const PORT = process.env.PORT || 3000;

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

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

const dotenvPackage = path.join(__dirname, 'node_modules', 'dotenv', 'package.json');
if (fsSync.existsSync(dotenvPackage)) {
  // eslint-disable-next-line global-require
  require('dotenv').config();
} else {
  log('warn', 'dotenv is not installed; using environment variables provided by the shell');
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
