/** Render the SVG logo and real app views into install icons and a social card.
 * npm install --no-save playwright@1.56.1 && npx playwright install chromium
 * node scripts/render-brand.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('..', import.meta.url));
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.png':'image/png' };
const server = createServer(async (req,res) => {
  let path = decodeURIComponent(new URL(req.url,'http://local').pathname);
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(root, '.' + path);
  if (!file.startsWith(root.replace(/\/$/, '') + sep)) { res.writeHead(403).end(); return; }
  try {res.writeHead(200, {'content-type': types[extname(file)] || 'application/octet-stream'}).end(await readFile(file));}
  catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({deviceScaleFactor:1});
  for (const [file,size,source] of [['icon-192.png',192,'icon.svg'],['icon-512.png',512,'icon.svg'],['apple-touch-icon.png',180,'maskable.svg'],['maskable-512.png',512,'maskable.svg'],['logo.png',512,'logo.svg']]) {
    await page.setViewportSize({width:size,height:size});
    await page.goto(`${base}/icons/${source}`);
    await page.screenshot({path:resolve(root,'icons',file),omitBackground:true});
  }
  const shots=[];
  for (const query of ['?preview&at=10:00&shape=1','?preview&at=22:30']) {
    await page.setViewportSize({width:390,height:844});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.goto(base+'/'+query);
    await page.waitForFunction(()=>window.__dayshaper && document.querySelector('#dial').children.length>0);
    await page.waitForTimeout(300);
    shots.push('data:image/png;base64,'+(await page.screenshot()).toString('base64'));
  }
  await page.setViewportSize({width:1200,height:630});
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>
    @font-face{font-family:Inter;src:url('${base}/fonts/inter-var.woff2')}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;overflow:hidden;background:linear-gradient(145deg,#e2eaf2 5%,#e5dce8 55%,#f6d8bd);color:#313448;font-family:Inter,sans-serif}
    .copy{position:absolute;left:68px;top:66px;width:500px}.brand{display:flex;align-items:center;gap:13px;font-size:27px;letter-spacing:-1px;font-weight:500}.brand img{width:58px;height:58px}
    h1{font-size:76px;font-weight:450;letter-spacing:-4.5px;line-height:1.05;margin:64px 0 26px}p{font-size:24px;line-height:1.45;color:#55596d;margin:0;letter-spacing:-.4px}.url{font-size:17px;letter-spacing:.2px;margin-top:63px;color:#62677c}
    .screen{position:absolute;width:245px;height:530px;object-fit:cover;border-radius:30px;border:1px solid #ffffff90;box-shadow:0 24px 65px #41456e25}.day{left:641px;top:48px;transform:rotate(-5deg)}.night{left:887px;top:108px;transform:rotate(5deg)}
  </style><div class="copy"><div class="brand"><img src="${base}/icons/icon.svg" alt="">Dayshaper</div><h1>Shape<br>your day.</h1><p>A tactile day planner,<br>under a sky that follows the sun.</p><p class="url">dayshaper.burooj.dev</p></div><img class="screen day" src="${shots[0]}" alt=""><img class="screen night" src="${shots[1]}" alt="">`);
  await page.evaluate(()=>document.fonts.ready);
  await page.waitForFunction(()=>[...document.images].every(i=>i.complete));
  await page.screenshot({path:resolve(root,'icons/og.png')});
  console.log('Rendered logo, four install icons, and 1200×630 social card.');
} finally {await browser.close();server.close();}
