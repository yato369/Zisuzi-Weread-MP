import { readFileSync } from 'node:fs';
import https from 'node:https';

const data = JSON.parse(readFileSync('D:/obsidian/collections/.obsidian/plugins/weread-mp-fork/data.json', 'utf8'));
const cookie = ((data.settings?.cookie) || data.cookie || '').replace(/^cookie:\s*/i, '');
if (!cookie) { console.log('NO_COOKIE'); process.exit(0); }
console.log('cookie fields:', cookie.split(';').map(s => s.trim().split('=')[0]).join(', '));

const headers = {
  Cookie: cookie,
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Referer: 'https://weread.qq.com/',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://weread.qq.com',
};

function raw(method, path) {
  return new Promise((resolve) => {
    const r = https.request({ hostname: 'weread.qq.com', path, method, headers, timeout: 15000 }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          setCookie: res.headers['set-cookie'] ?? null,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
    });
    r.on('error', (e) => resolve({ status: 0, setCookie: null, body: 'ERROR: ' + e.message }));
    r.on('timeout', () => { try { r.destroy(); } catch {} });
    r.end();
  });
}

const p = await raw('POST', '/web/login/renewal');
console.log('[renewal POST] status:', p.status);
console.log('[renewal POST] set-cookie:', JSON.stringify(p.setCookie));
console.log('[renewal POST] body:', p.body.slice(0, 300));
