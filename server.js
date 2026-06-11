const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname)));

// ── Claude API proxy ──────────────────────────────────────────────────────────
app.post('/api/claude', (req, res) => {
  const body = JSON.stringify(req.body);
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };

  const apiReq = https.request(options, (apiRes) => {
    let data = '';
    apiRes.on('data', chunk => data += chunk);
    apiRes.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(data);
    });
  });

  apiReq.on('error', err => res.status(500).json({ error: err.message }));
  apiReq.write(body);
  apiReq.end();
});

app.options('/api/claude', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.sendStatus(200);
});

// ── iCal proxy (fetches Google Calendar iCal URLs to avoid CORS) ──────────────
app.get('/api/ical', (req, res) => {
  const icalUrl = req.query.url;
  if (!icalUrl) return res.status(400).json({ error: 'Missing url parameter' });

  let parsed;
  try { parsed = new URL(icalUrl); } catch(e) { return res.status(400).json({ error: 'Invalid URL' }); }

  // Only allow Google Calendar and Outlook iCal URLs
  const allowed = ['calendar.google.com', 'outlook.live.com', 'outlook.office365.com', 'outlook.office.com'];
  if (!allowed.some(h => parsed.hostname.endsWith(h))) {
    return res.status(403).json({ error: 'Only Google Calendar and Outlook iCal URLs are supported' });
  }

  const lib = parsed.protocol === 'https:' ? https : http;
  const options = {
    hostname: parsed.hostname,
    path: parsed.pathname + parsed.search,
    method: 'GET',
    headers: { 'User-Agent': 'TimeForge/1.0' }
  };

  const proxyReq = lib.request(options, (proxyRes) => {
    if (proxyRes.statusCode === 301 || proxyRes.statusCode === 302) {
      // Follow one redirect
      const location = proxyRes.headers['location'];
      if (!location) return res.status(502).json({ error: 'Redirect with no location' });
      return res.redirect('/api/ical?url=' + encodeURIComponent(location));
    }
    let data = '';
    proxyRes.on('data', chunk => data += chunk);
    proxyRes.on('end', () => {
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.send(data);
    });
  });

  proxyReq.on('error', err => res.status(502).json({ error: err.message }));
  proxyReq.end();
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TimeForge running on port ${PORT}`));
