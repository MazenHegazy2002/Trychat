/** Starter designs for the Design studio. Each board is self-contained HTML in one shared design system. */

export interface DesignTemplate {
  key: string;
  title: string;
  subtitle: string;
  icon: 'smartphone' | 'monitor' | 'bar-chart-2';
  notes: string;
  boards: { name: string; html: string; width: number; height: number }[];
}

const MOBILE_CSS = `:root{--bg:#FAF9F5;--surface:#fff;--text:#141413;--muted:#5E5D59;--accent:#B5532F;--soft:#F0EEE6;--r:18px}
*{box-sizing:border-box}body{margin:0;width:390px;height:844px;background:var(--bg);color:var(--text);font:15px/1.45 -apple-system,system-ui,sans-serif;overflow:hidden;position:relative}
.sb{height:44px;display:flex;justify-content:space-between;align-items:center;padding:0 24px;font-weight:600;font-size:14px}
.pad{padding:8px 20px}h1{font:600 28px/1.15 Georgia,serif;margin:8px 0 4px}.muted{color:var(--muted)}
.card{background:var(--surface);border:1px solid rgba(31,30,29,.1);border-radius:var(--r);padding:16px;margin-top:12px}
.row{display:flex;align-items:center;gap:12px}.grow{flex:1}.chip{background:var(--soft);border-radius:999px;padding:6px 12px;font-size:13px}
.btn{display:block;text-align:center;background:var(--text);color:var(--bg);text-decoration:none;border-radius:999px;padding:15px;font-weight:600;margin-top:16px}
.tabs{position:absolute;left:0;right:0;bottom:0;height:84px;background:var(--surface);border-top:1px solid rgba(31,30,29,.1);display:flex;justify-content:space-around;padding-top:12px;font-size:11px}
.tabs a{color:var(--muted);text-decoration:none;text-align:center}.tabs a.on{color:var(--accent)}
.ic{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;font-size:20px}
a{color:inherit}`;

const mobile = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><style>${MOBILE_CSS}</style></head><body><div class="sb"><span>9:41</span><span>●●● ▮</span></div>${body}
<nav class="tabs"><a href="Home.html" class="on">⌂<br>Home</a><a href="Activity.html">↯<br>Activity</a><a href="Profile.html">◯<br>Profile</a></nav></body></html>`;

const tx = (icon: string, bg: string, name: string, sub: string, amt: string) =>
  `<div class="row" style="padding:10px 0"><div class="ic" style="background:${bg}">${icon}</div><div class="grow"><b>${name}</b><div class="muted" style="font-size:13px">${sub}</div></div><b>${amt}</b></div>`;

const DESK_CSS = `:root{--bg:#FAF9F5;--text:#141413;--muted:#5E5D59;--accent:#B5532F;--soft:#F0EEE6}
*{box-sizing:border-box}body{margin:0;width:1440px;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,system-ui,sans-serif}
a{color:inherit;text-decoration:none}.wrap{max-width:1200px;margin:0 auto;padding:0 40px}
.btn{display:inline-block;background:var(--text);color:var(--bg);border-radius:999px;padding:14px 26px;font-weight:600}
.ghost{background:transparent;color:var(--text);border:1px solid rgba(31,30,29,.2)}
.serif{font-family:Georgia,serif;font-weight:500}.muted{color:var(--muted)}
.card{background:#fff;border:1px solid rgba(31,30,29,.1);border-radius:20px;padding:28px}`;

export const DESIGN_TEMPLATES: DesignTemplate[] = [
  {
    key: 'mobile',
    title: 'Pocket — budgeting app',
    subtitle: 'Three linked phone screens',
    icon: 'smartphone',
    notes: 'Calm personal-finance app. Warm ivory, ink and clay accent; Georgia headings, system UI text.',
    boards: [
      {
        name: 'Home',
        width: 390,
        height: 844,
        html: mobile(`<div class="pad"><div class="muted">Good morning, Maya</div><h1>$4,218.40</h1><div class="muted">Available across 3 accounts</div>
<div class="card" style="background:var(--text);color:var(--bg)"><div class="row"><div class="grow"><div style="opacity:.7;font-size:13px">October budget</div><b style="font-size:20px">$1,240 of $2,000</b></div><span class="chip" style="background:#D97757;color:#141413">62%</span></div>
<div style="height:8px;background:rgba(255,255,255,.15);border-radius:9px;margin-top:14px"><div style="width:62%;height:100%;background:#D97757;border-radius:9px"></div></div></div>
<div class="row" style="margin-top:20px"><b class="grow">Recent</b><a href="Activity.html" style="color:var(--accent);font-weight:600">See all</a></div>
<div class="card" style="padding:6px 16px">${tx('☕', '#F3E3D3', 'Blue Bottle Coffee', 'Today · Food', '−$6.50')}${tx('🚇', '#DDE7F0', 'Metro card', 'Yesterday · Transit', '−$33.00')}${tx('💼', '#DCEBDD', 'Northwind payroll', 'Oct 15 · Income', '+$2,860')}</div>
<a class="btn" href="Activity.html">Add expense</a></div>`),
      },
      {
        name: 'Activity',
        width: 390,
        height: 844,
        html: mobile(`<div class="pad"><h1>Activity</h1><div class="row" style="gap:8px;margin-top:10px"><span class="chip" style="background:var(--text);color:var(--bg)">All</span><span class="chip">Food</span><span class="chip">Transit</span><span class="chip">Bills</span></div>
<div class="card"><div class="muted" style="font-size:13px">Spent this week</div><b style="font-size:24px">$312.75</b>
<svg viewBox="0 0 320 90" width="100%" height="90" style="margin-top:8px">${[38, 62, 30, 75, 50, 88, 44].map((h, i) => `<rect x="${i * 46 + 6}" y="${90 - h}" width="30" height="${h}" rx="7" fill="${i === 5 ? '#B5532F' : '#E3DACC'}"/>`).join('')}</svg>
<div class="row muted" style="justify-content:space-between;font-size:12px"><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span></div></div>
<div class="card" style="padding:6px 16px">${tx('🛒', '#DCEBDD', 'Trader Joe’s', 'Sat · Groceries', '−$84.20')}${tx('🎬', '#E8DDF0', 'Alamo Drafthouse', 'Fri · Fun', '−$28.00')}${tx('💡', '#F6EBC8', 'Con Edison', 'Thu · Bills', '−$96.40')}${tx('☕', '#F3E3D3', 'Blue Bottle Coffee', 'Thu · Food', '−$6.50')}</div></div>`).replace('class="on"', '').replace('href="Activity.html"', 'href="Activity.html" class="on"'),
      },
      {
        name: 'Profile',
        width: 390,
        height: 844,
        html: mobile(`<div class="pad" style="text-align:center"><div style="width:88px;height:88px;border-radius:50%;margin:16px auto 8px;background:linear-gradient(135deg,#D97757,#E3DACC);display:grid;place-items:center;font:600 32px Georgia,serif;color:#fff">M</div>
<h1 style="font-size:24px">Maya Chen</h1><div class="muted">Member since 2023</div></div>
<div class="pad"><div class="card" style="padding:4px 16px">${['Linked accounts|3 banks', 'Monthly budget|$2,000', 'Notifications|On', 'Currency|USD'].map((r) => `<div class="row" style="padding:14px 0;border-bottom:1px solid rgba(31,30,29,.08)"><span class="grow">${r.split('|')[0]}</span><span class="muted">${r.split('|')[1]} ›</span></div>`).join('')}</div>
<a class="btn" href="Home.html" style="background:var(--soft);color:var(--text)">Back to home</a></div>`).replace('class="on"', '').replace('href="Profile.html"', 'href="Profile.html" class="on"'),
      },
    ],
  },
  {
    key: 'landing',
    title: 'Fieldnote — landing page',
    subtitle: 'Desktop marketing page',
    icon: 'monitor',
    notes: 'Landing page for a note-taking app for researchers. Editorial serif headlines, warm neutrals.',
    boards: [
      {
        name: 'Landing',
        width: 1440,
        height: 1500,
        html: `<!doctype html><html><head><meta charset="utf-8"><style>${DESK_CSS}</style></head><body>
<header class="wrap" style="display:flex;align-items:center;height:88px;gap:32px"><b style="font:600 22px Georgia,serif">Fieldnote</b><nav class="muted" style="display:flex;gap:28px;flex:1"><a href="#">Product</a><a href="#">Research teams</a><a href="#">Pricing</a></nav><a href="#">Sign in</a><a class="btn" href="#">Start free</a></header>
<section class="wrap" style="text-align:center;padding:96px 40px 72px"><span style="background:var(--soft);border-radius:999px;padding:6px 14px;font-size:14px">New · Interview transcripts with highlights</span>
<h1 class="serif" style="font-size:76px;line-height:1.05;margin:28px auto 20px;max-width:900px">Every insight from your research, in one quiet place.</h1>
<p class="muted" style="font-size:20px;max-width:620px;margin:0 auto 36px">Fieldnote turns interviews, surveys and sticky notes into a searchable library your whole team can build on.</p>
<a class="btn" href="#">Start free for 14 days</a> &nbsp; <a class="btn ghost" href="#">Watch a 2‑min tour</a></section>
<section class="wrap"><div class="card" style="padding:0;overflow:hidden;box-shadow:0 30px 80px rgba(20,20,19,.12)"><div style="display:grid;grid-template-columns:240px 1fr;height:420px">
<div style="background:var(--soft);padding:24px;font-size:14px" class="muted"><b style="color:var(--text)">Onboarding study</b><p>12 interviews</p><p>48 highlights</p><p>6 themes</p></div>
<div style="padding:28px;display:grid;grid-template-columns:repeat(3,1fr);gap:16px;align-content:start">${['“I never know where the latest plan lives.”|Findability', '“Setup took our team a whole afternoon.”|Onboarding', '“I want to share a clip, not a doc.”|Sharing', '“Tags drift between projects.”|Taxonomy', '“Exports should look presentable.”|Reporting', '“Search should understand synonyms.”|Findability'].map((q) => `<div style="background:#FFF8EE;border:1px solid #F0DFC6;border-radius:14px;padding:16px;font-size:15px">${q.split('|')[0]}<div style="margin-top:10px;font-size:12px;color:var(--accent);font-weight:600">${q.split('|')[1]}</div></div>`).join('')}</div></div></div></section>
<section class="wrap" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px;padding:96px 40px">${['Capture anything|Record calls, import surveys, or paste notes. Transcripts arrive in minutes.', 'Find patterns|Highlight quotes and cluster them into themes with one drag.', 'Share the story|Publish a living report stakeholders actually read.'].map((f) => `<div class="card"><h3 class="serif" style="font-size:26px;margin:0 0 8px">${f.split('|')[0]}</h3><p class="muted" style="margin:0">${f.split('|')[1]}</p></div>`).join('')}</section>
<footer class="wrap muted" style="border-top:1px solid rgba(31,30,29,.12);padding:32px 40px;display:flex;justify-content:space-between;font-size:14px"><span>© 2026 Fieldnote Inc.</span><span>Privacy · Terms · Status</span></footer></body></html>`,
      },
    ],
  },
  {
    key: 'dashboard',
    title: 'Ledgerline — analytics dashboard',
    subtitle: 'Desktop SaaS dashboard',
    icon: 'bar-chart-2',
    notes: 'Revenue analytics dashboard. Dense but calm; ink sidebar, clay highlights.',
    boards: [
      {
        name: 'Dashboard',
        width: 1440,
        height: 900,
        html: `<!doctype html><html><head><meta charset="utf-8"><style>${DESK_CSS}body{height:900px;display:grid;grid-template-columns:240px 1fr;overflow:hidden}</style></head><body>
<aside style="background:#1F1E1D;color:#E8E6DC;padding:28px 20px;font-size:15px"><b style="font:600 20px Georgia,serif;color:#fff">Ledgerline</b><nav style="margin-top:32px;display:grid;gap:6px">${['Overview', 'Revenue', 'Customers', 'Invoices', 'Reports', 'Settings'].map((n, i) => `<a href="#" style="padding:10px 12px;border-radius:10px;${i === 0 ? 'background:rgba(255,255,255,.1);color:#fff' : 'opacity:.7'}">${n}</a>`).join('')}</nav></aside>
<main style="padding:32px 40px"><div style="display:flex;align-items:center"><h1 class="serif" style="font-size:34px;margin:0;flex:1">Overview</h1><span class="muted" style="margin-right:16px">Oct 1 – Oct 24, 2026</span><a class="btn" href="#" style="padding:10px 20px">Export</a></div>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:20px;margin-top:28px">${['MRR|$184,320|+8.2%', 'Active customers|2,941|+3.1%', 'Churn|1.8%|−0.4 pts', 'ARPA|$62.70|+4.9%'].map((k) => `<div class="card" style="padding:22px"><div class="muted" style="font-size:14px">${k.split('|')[0]}</div><div style="font-size:30px;font-weight:600;margin:6px 0">${k.split('|')[1]}</div><div style="color:#2F7D4F;font-size:14px;font-weight:600">${k.split('|')[2]}</div></div>`).join('')}</div>
<div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-top:20px"><div class="card"><b>Revenue, last 12 months</b><svg viewBox="0 0 700 260" width="100%" height="260" style="margin-top:12px"><path d="M0 220 L64 205 L128 210 L192 180 L256 170 L320 150 L384 155 L448 120 L512 110 L576 90 L640 70 L700 52 L700 260 L0 260Z" fill="#F3E3D3"/><path d="M0 220 L64 205 L128 210 L192 180 L256 170 L320 150 L384 155 L448 120 L512 110 L576 90 L640 70 L700 52" fill="none" stroke="#B5532F" stroke-width="3"/></svg></div>
<div class="card"><b>Top plans</b>${['Business|48%', 'Team|31%', 'Starter|21%'].map((p) => `<div style="margin-top:20px"><div style="display:flex;justify-content:space-between;font-size:14px"><span>${p.split('|')[0]}</span><b>${p.split('|')[1]}</b></div><div style="height:8px;background:var(--soft);border-radius:9px;margin-top:6px"><div style="height:100%;width:${p.split('|')[1]};background:#141413;border-radius:9px"></div></div></div>`).join('')}</div></div>
<div class="card" style="margin-top:20px;padding:20px 28px"><b>Recent invoices</b><table style="width:100%;border-collapse:collapse;margin-top:10px;font-size:14px">${['Acme Robotics|INV-2041|$4,800|Paid', 'Bluebird Health|INV-2040|$2,150|Due Oct 30', 'Kestrel Labs|INV-2039|$960|Paid'].map((r) => `<tr style="border-top:1px solid rgba(31,30,29,.08)">${r.split('|').map((c) => `<td style="padding:10px 0">${c}</td>`).join('')}</tr>`).join('')}</table></div></main></body></html>`,
      },
    ],
  },
];
