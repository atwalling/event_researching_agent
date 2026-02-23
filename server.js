const http = require('http');
const fs = require('fs/promises');
const path = require('path');
const { runResearch, TOP_SPORTS } = require('./src/research');

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
  if (req.method === 'GET' && req.url === '/api/config') {
    sendJson(res, 200, { topSports: TOP_SPORTS, providers: ['web-search-3-fast', 'deep-research-pro-preview-12-2025', 'o4-mini-deep-research-2025-06-26'] });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/research') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', async () => {
      try {
        const params = JSON.parse(body);
        const results = await runResearch({
          city: params.city,
          centerpoint: params.centerpoint,
          radiusMiles: Number(params.radiusMiles),
          sport: params.sport,
          timeframeMonths: Number(params.timeframeMonths),
          agentCount: Number(params.agentCount),
          includeJoinable: Boolean(params.includeJoinable),
          includeWatchable: Boolean(params.includeWatchable),
          researchModel: params.researchModel || 'o4-mini-deep-research-2025-06-26'
        });
        sendJson(res, 200, results);
      } catch (error) {
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
