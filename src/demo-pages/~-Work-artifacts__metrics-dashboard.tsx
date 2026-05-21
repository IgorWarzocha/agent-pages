import { useMemo, useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

const artifactStyles = `
.metrics{min-height:100vh;display:grid;align-content:center;gap:16px;overflow:hidden}.metrics-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end}.metrics h1{max-width:11ch;margin:0;font-size:clamp(44px,6vw,88px);line-height:.84;letter-spacing:-.08em;text-wrap:balance}.metrics p:not(.eyebrow){max-width:54ch;margin:12px 0 0;color:var(--muted);font-size:15px;line-height:1.42;text-wrap:pretty}.metrics-tabs{display:flex;gap:8px;align-items:center;justify-content:flex-end}.metrics-tabs button{min-height:38px;border:0;border-radius:999px;background:var(--panel);color:var(--muted);padding:0 14px;font-weight:850;cursor:pointer;box-shadow:inset 0 0 0 1px var(--line)}.metrics-tabs button.active{background:var(--accent);color:var(--accent-ink)}.metrics-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:12px}.metrics-card{min-width:0;border-radius:30px;background:var(--panel);padding:18px;box-shadow:var(--shadow),inset 0 0 0 1px var(--line)}.metrics-card.dark{background:var(--charcoal);color:var(--accent-ink)}.metrics-card h2{margin:0 0 12px;font-size:20px;line-height:1;letter-spacing:-.04em}.metrics-chart{height:260px}.metrics-row{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metrics-kpi{border-radius:24px;background:var(--panel);padding:18px;box-shadow:inset 0 0 0 1px var(--line)}.metrics-kpi span{display:block;color:var(--muted);font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.08em}.metrics-kpi b{display:block;margin-top:9px;font-size:34px;line-height:.9;letter-spacing:-.07em;font-variant-numeric:tabular-nums}.metrics-kpi small{display:block;margin-top:8px;color:var(--muted);font-size:12px}.metrics-list{display:grid;gap:8px;margin:0;padding:0;list-style:none}.metrics-list li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border-radius:16px;background:color-mix(in oklch,currentColor 7%,transparent);padding:10px 12px}.metrics-list b{font-size:13px}.metrics-list span{color:color-mix(in oklch,currentColor 62%,transparent);font-size:12px}.metrics-tooltip{border-radius:14px;background:#10121a;color:#eef0ff;padding:8px 10px;box-shadow:0 14px 40px #0008;font-size:12px}.metrics .recharts-text{fill:color-mix(in oklch,var(--ink) 58%,transparent);font-size:11px}.metrics .recharts-cartesian-grid line{stroke:color-mix(in oklch,var(--line) 58%,transparent)}@media(max-width:1000px){.metrics{align-content:start;overflow:visible}.metrics-hero,.metrics-grid,.metrics-row{grid-template-columns:1fr}.metrics-tabs{justify-content:flex-start;flex-wrap:wrap}.metrics-chart{height:240px}}`;

const series = {
  weekly: [
    { name: 'Mon', pages: 3, notes: 7, fixes: 2 },
    { name: 'Tue', pages: 5, notes: 11, fixes: 4 },
    { name: 'Wed', pages: 4, notes: 9, fixes: 3 },
    { name: 'Thu', pages: 8, notes: 18, fixes: 7 },
    { name: 'Fri', pages: 7, notes: 15, fixes: 6 },
  ],
  monthly: [
    { name: 'W1', pages: 16, notes: 34, fixes: 12 },
    { name: 'W2', pages: 24, notes: 51, fixes: 18 },
    { name: 'W3', pages: 21, notes: 44, fixes: 16 },
    { name: 'W4', pages: 31, notes: 69, fixes: 25 },
  ],
};

const mix = [
  { name: 'Plans', value: 34, color: '#b9bff3' },
  { name: 'UI reviews', value: 27, color: '#8abeb7' },
  { name: 'Dashboards', value: 22, color: '#f0c674' },
  { name: 'Games', value: 17, color: '#d06b72' },
];

const agents = [
  { name: 'Pi', score: 94 },
  { name: 'Codex', score: 88 },
  { name: 'Claude', score: 81 },
  { name: 'opencode', score: 76 },
];

function TooltipBox({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="metrics-tooltip"><b>{label}</b>{payload.map(item => <div key={item.name}>{item.name}: {item.value}</div>)}</div>;
}

export default function MetricsDashboardDemo() {
  const [range, setRange] = useState<'weekly' | 'monthly'>('weekly');
  const data = series[range];
  const totals = useMemo(() => data.reduce((sum, item) => ({ pages: sum.pages + item.pages, notes: sum.notes + item.notes, fixes: sum.fixes + item.fixes }), { pages: 0, notes: 0, fixes: 0 }), [data]);
  const decisionRate = Math.round((totals.fixes / Math.max(1, totals.notes)) * 100);

  return <><style>{artifactStyles}</style><main className="sheet metrics"><section className="metrics-hero"><div><p className="eyebrow">charts artifact</p><h1>Review telemetry</h1><p>A dashboard-style artifact with live range switching, composed charts, KPIs, and ranked lists. This is the kind of thing agents can make without you installing chart libraries first.</p></div><div className="metrics-tabs"><button className={range === 'weekly' ? 'active' : ''} onClick={() => setRange('weekly')}>Week</button><button className={range === 'monthly' ? 'active' : ''} onClick={() => setRange('monthly')}>Month</button></div></section><section className="metrics-row"><article className="metrics-kpi"><span>Artifacts</span><b>{totals.pages}</b><small>pages reviewed</small></article><article className="metrics-kpi"><span>Annotations</span><b>{totals.notes}</b><small>React Grab notes</small></article><article className="metrics-kpi"><span>Applied</span><b>{totals.fixes}</b><small>feedback fixes</small></article><article className="metrics-kpi"><span>Close rate</span><b>{decisionRate}%</b><small>notes resolved</small></article></section><section className="metrics-grid"><article className="metrics-card"><h2>Artifact feedback loop</h2><div className="metrics-chart"><ResponsiveContainer width="100%" height="100%"><AreaChart data={data}><CartesianGrid vertical={false} /><XAxis dataKey="name" tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} /><Tooltip content={<TooltipBox />} /><Area type="monotone" dataKey="notes" stroke="#b9bff3" fill="#b9bff344" strokeWidth={3} /><Line type="monotone" dataKey="fixes" stroke="#86d9a0" strokeWidth={3} dot={false} /></AreaChart></ResponsiveContainer></div></article><article className="metrics-card dark"><h2>Artifact mix</h2><div className="metrics-chart"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={mix} dataKey="value" nameKey="name" innerRadius="54%" outerRadius="82%" paddingAngle={3}>{mix.map(item => <Cell key={item.name} fill={item.color} />)}</Pie><Tooltip content={<TooltipBox />} /></PieChart></ResponsiveContainer></div></article><article className="metrics-card"><h2>Agent usefulness score</h2><div className="metrics-chart"><ResponsiveContainer width="100%" height="100%"><BarChart data={agents} layout="vertical" margin={{ left: 12 }}><CartesianGrid horizontal={false} /><XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} /><YAxis type="category" dataKey="name" tickLine={false} axisLine={false} width={76} /><Tooltip content={<TooltipBox />} /><Bar dataKey="score" fill="#8abeb7" radius={[0, 10, 10, 0]} /></BarChart></ResponsiveContainer></div></article><article className="metrics-card"><h2>What changed</h2><ul className="metrics-list"><li><b>Plans became visual</b><span>less chat archaeology</span></li><li><b>Feedback got copyable</b><span>annotations back to agent</span></li><li><b>Review cycles shrank</b><span>specific UI/logic fixes</span></li><li><b>Artifacts stayed disposable</b><span>delete stale pages</span></li></ul></article></section></main></>;
}
