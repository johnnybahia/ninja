// One-off: renders the app icons (public/icons/*.png) from the 影 logo. Needs playwright-core and
// a system CJK font; the PNGs are committed, so the build does not run this.
import { chromium } from 'playwright-core';
import path from 'path';

const out = process.env.OUT || path.resolve(import.meta.dirname, '../public/icons');
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:radial-gradient(circle at 50% 38%,#3a2a58 0%,#2b2140 38%,#16121f 78%);display:flex;align-items:center;justify-content:center;position:relative}
.sun{position:absolute;width:56vmin;height:56vmin;border-radius:50%;background:radial-gradient(circle,rgba(200,50,60,.42),rgba(200,50,60,0) 70%)}
.k{position:relative;font:900 50vmin/1 'WenQuanYi Zen Hei','Noto Serif CJK JP','Noto Sans CJK JP',serif;color:#c8323c;text-shadow:0 0 5vmin rgba(200,50,60,.55),0 .8vmin 0 #7a1c24;margin-top:-3vmin}
.bar{position:absolute;left:30vmin;right:30vmin;bottom:25vmin;height:1.6vmin;border-radius:1vmin;background:#f2a65a;opacity:.85}
</style><div class="sun"></div><div class="k">影</div><div class="bar"></div>`;

const b = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [name, size] of [['icon-512', 512], ['icon-192', 192], ['apple-touch-icon', 180]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(html);
  await p.screenshot({ path: path.join(out, `${name}.png`) });
  await p.close();
}
await b.close();
