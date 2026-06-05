import type { Project, TaskId, TaskSchedule } from '@/entities';
import { buildVisibleRows } from '@/features/grid/treeModel';
import { buildTimeline } from '@/features/gantt/timeline';
import { ZOOM_CONFIGS, type ZoomLevel } from '@/features/gantt/zoom';
import { PRIORITY_COLORS } from '@/features/gantt/colors';
import { bridge } from '@/shared/bridge';

export interface HtmlExportInput {
  project: Project;
  schedules: Map<TaskId, TaskSchedule>;
  zoom: ZoomLevel;
  theme: 'light' | 'dark';
  showCritical: boolean;
  showBaseline: boolean;
}

export async function exportHtml(input: HtmlExportInput, fileName: string): Promise<void> {
  const html = buildHtmlContent(input);
  const bytes = new TextEncoder().encode(html);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  await bridge().export.saveBinary(`${fileName}.html`, btoa(binary), [
    { name: 'HTML File', extensions: ['html'] },
  ]);
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtmlContent(input: HtmlExportInput): string {
  const { project, schedules, zoom, theme, showCritical, showBaseline } = input;

  const allRows = buildVisibleRows(project.tasks, { includeCollapsed: true });
  const dayWidth = ZOOM_CONFIGS[zoom].dayWidth;
  const timeline = buildTimeline(project.tasks, project.startDate, dayWidth);

  const groupColorMap = new Map<string, string>();
  for (const g of project.viewGroups) {
    for (const tid of g.taskIds) {
      if (!groupColorMap.has(tid)) groupColorMap.set(tid, g.color);
    }
  }
  const assigneeColorMap = new Map<string, string>();
  for (const task of project.tasks) {
    if (task.assigneeIds.length > 0) {
      const r = project.resources.find((x) => x.id === task.assigneeIds[0]);
      if (r?.color) assigneeColorMap.set(task.id, r.color);
    }
  }
  const activeBaseline = project.activeBaselineId
    ? (project.baselines.find((b) => b.id === project.activeBaselineId) ?? null)
    : null;
  const baselineMap = activeBaseline
    ? new Map(activeBaseline.entries.map((e) => [e.taskId, e]))
    : null;

  const rows = allRows.map((row) => {
    const t = row.task;
    const isCritical = showCritical && (schedules.get(t.id)?.isCritical ?? false);
    const barColor = (t.cancelled ?? false)
      ? '#9ca3af'
      : (t.color ?? groupColorMap.get(t.id) ?? assigneeColorMap.get(t.id) ??
        (isCritical ? '#ef4444' : PRIORITY_COLORS[t.priority]));
    const bl = baselineMap?.get(t.id) ?? null;
    return {
      id: t.id,
      parentId: t.parentId as string | null,
      wbs: row.wbs,
      depth: row.depth,
      hasChildren: row.hasChildren,
      name: t.name,
      start: t.start,
      end: t.end,
      progress: t.progress,
      isMilestone: t.isMilestone,
      cancelled: t.cancelled ?? false,
      isCritical,
      barColor,
      baselineStart: showBaseline && bl ? bl.start : null,
      baselineEnd: showBaseline && bl ? bl.end : null,
      assigneeNames: t.assigneeIds
        .map((id) => project.resources.find((r) => r.id === id)?.name ?? '')
        .filter(Boolean)
        .join(', '),
      collapsed: t.collapsed ?? false,
    };
  });

  const data = {
    projectName: project.name,
    today: new Date().toISOString().slice(0, 10),
    theme,
    defaultDayWidth: dayWidth,
    timeline: { start: timeline.start, end: timeline.end, totalDays: timeline.totalDays },
    rows,
    deps: project.dependencies.map((d) => ({ fromId: d.fromId, toId: d.toId, type: d.type })),
    markers: (project.markers ?? []).map((m) => ({ date: m.date, label: m.label, color: m.color })),
    holidays: project.holidays.map((h) => h.date),
    weekendDays: [0, 1, 2, 3, 4, 5, 6].filter((d) => !project.calendar.workingWeekdays.includes(d)),
  };

  return template(esc(project.name), JSON.stringify(data));
}

// ---------------------------------------------------------------------------
// Self-contained HTML template
// ---------------------------------------------------------------------------
function template(title: string, dataJson: string): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - Gantt</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:12px}
body{background:var(--bg)}
#app{display:flex;flex-direction:column;height:100vh}
/* toolbar */
#toolbar{display:flex;align-items:center;gap:5px;padding:5px 10px;border-bottom:1px solid var(--border);background:var(--surface2);flex-shrink:0;flex-wrap:wrap}
#proj-title{font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.sep{width:1px;height:18px;background:var(--border);margin:0 2px}
.btn{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border:1px solid var(--border);border-radius:4px;background:var(--surface);color:var(--text);cursor:pointer;font-size:11px;font-family:inherit;transition:background .12s}
.btn:hover{background:var(--surface3)}
.btn:disabled{opacity:.35;cursor:default}
#zoom-lbl{font-size:11px;color:var(--text-muted);min-width:26px;text-align:center}
/* main */
#main{display:flex;flex:1;min-height:0;overflow:hidden}
/* grid pane */
#grid-pane{display:flex;flex-direction:column;width:300px;flex-shrink:0;overflow:hidden;border-right:1px solid var(--border)}
#grid-hdr{height:52px;background:var(--surface2);border-bottom:1px solid var(--border);display:flex;align-items:stretch;flex-shrink:0}
.gh-col{display:flex;align-items:center;padding:0 6px;font-size:10px;font-weight:600;color:var(--text-muted);border-right:1px solid var(--border);overflow:hidden;white-space:nowrap}
.gh-name{flex:1}
.gh-start{width:72px}
.gh-prog{width:44px;justify-content:center}
#grid-body{flex:1;overflow-y:auto;overflow-x:hidden}
.gr{display:flex;align-items:center;height:32px;border-bottom:1px solid var(--border-faint);cursor:default}
.gr:hover{background:var(--surface2)}
.gr-name-cell{flex:1;min-width:0;display:flex;align-items:center;overflow:hidden;padding:0 4px}
.tog{width:16px;height:16px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:none;background:transparent;cursor:pointer;color:var(--text-muted);font-size:9px;border-radius:3px;padding:0}
.tog:hover{background:var(--surface3)}
.gr-name{flex:1;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gr-name.bold{font-weight:600}
.gr-name.faint{opacity:.5;text-decoration:line-through}
.gr-name.crit{color:var(--critical)}
.gr-start{width:72px;font-size:10px;color:var(--text-muted);padding:0 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gr-prog{width:44px;padding:0 6px;display:flex;align-items:center}
.pb{height:5px;border-radius:3px;background:var(--border);width:100%;overflow:hidden}
.pf{height:100%;border-radius:3px;background:var(--accent)}
/* resizer */
#resizer{width:4px;cursor:col-resize;background:transparent;flex-shrink:0;transition:background .12s}
#resizer:hover,#resizer.drag{background:var(--accent)}
/* chart pane */
#chart-pane{flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative}
#hdr-wrap{height:52px;flex-shrink:0;overflow:hidden;position:relative}
#hdr-canvas{position:absolute;top:0;left:0}
#chart-body{flex:1;position:relative;overflow:hidden}
#chart-scroll{position:absolute;inset:0;overflow:auto}
#chart-spacer{position:relative}
#body-canvas{position:absolute;top:0;left:0;pointer-events:none}
/* scrollbars — always visible, thick enough to grab */
#chart-scroll::-webkit-scrollbar,
#grid-body::-webkit-scrollbar{width:10px;height:10px}
#chart-scroll::-webkit-scrollbar-track,
#grid-body::-webkit-scrollbar-track{background:var(--surface2)}
#chart-scroll::-webkit-scrollbar-thumb,
#grid-body::-webkit-scrollbar-thumb{background:var(--text-muted);border-radius:5px;border:2px solid var(--surface2)}
#chart-scroll::-webkit-scrollbar-thumb:hover,
#grid-body::-webkit-scrollbar-thumb:hover{background:var(--text)}
#chart-scroll::-webkit-scrollbar-corner{background:var(--surface2)}
/* pan mode cursor overrides */
#chart-scroll.pan{cursor:grab}
#chart-scroll.panning{cursor:grabbing;user-select:none}
/* active toolbar button */
.btn.active{background:var(--accent-dim);border-color:var(--accent);color:var(--accent)}
</style>
</head>
<body>
<div id="app">
  <div id="toolbar">
    <span id="proj-title"></span>
    <div class="sep"></div>
    <button class="btn" id="btn-exp" title="전체 펼치기">⌄⌄</button>
    <button class="btn" id="btn-col" title="전체 접기">⌃⌃</button>
    <div class="sep"></div>
    <button class="btn" id="btn-zo" title="축소">◀</button>
    <span id="zoom-lbl"></span>
    <button class="btn" id="btn-zi" title="확대">▶</button>
    <div class="sep"></div>
    <button class="btn" id="btn-today">오늘</button>
    <div class="sep"></div>
    <button class="btn" id="btn-theme">◑</button>
    <div class="sep"></div>
    <button class="btn" id="btn-pan" title="손바닥(드래그 이동) 켜기/끄기 — 스페이스바 일시 사용 가능">🤚</button>
    <span style="margin-left:auto;font-size:10px;color:var(--text-muted)" id="exp-date"></span>
  </div>
  <div id="main">
    <div id="grid-pane">
      <div id="grid-hdr">
        <div class="gh-col gh-name">작업명</div>
        <div class="gh-col gh-start">시작일</div>
        <div class="gh-col gh-prog">진척률</div>
      </div>
      <div id="grid-body"></div>
    </div>
    <div id="resizer"></div>
    <div id="chart-pane">
      <div id="hdr-wrap"><canvas id="hdr-canvas"></canvas></div>
      <div id="chart-body">
        <div id="chart-scroll"><div id="chart-spacer"></div></div>
        <canvas id="body-canvas"></canvas>
      </div>
    </div>
  </div>
</div>
<script>
const DATA = ${dataJson};
// ── constants ───────────────────────────────────────────
const ROW_H=32, HDR_H=52, BAR_H=18, BAR_VPAD=7;
const ZOOM_STEPS=[0.9,2.2,6,18,40,240];
const ZOOM_LBLS=['연','분기','월','주','일','시간'];
// ── palettes ────────────────────────────────────────────
const PAL={
  dark:{
    vars:{'--bg':'#0f172a','--surface':'#1e293b','--surface2':'#0f172a','--surface3':'#334155',
      '--text':'#e2e8f0','--text-muted':'#94a3b8','--border':'rgba(148,163,184,0.20)',
      '--border-faint':'rgba(148,163,184,0.10)','--accent':'#6366f1','--accent-dim':'rgba(99,102,241,0.15)',
      '--critical':'#ef4444'},
    c:{bg:'#0f172a',surface:'#1e293b',surface2:'#0f172a',text:'#e2e8f0',textMuted:'#94a3b8',
      grid:'rgba(148,163,184,0.12)',gridStrong:'rgba(148,163,184,0.30)',
      weekend:'rgba(148,163,184,0.06)',holiday:'rgba(248,113,113,0.10)',
      today:'#f87171',critical:'#ef4444',progress:'rgba(0,0,0,0.28)',link:'#94a3b8',
      baseline:'rgba(148,163,184,0.55)'}
  },
  light:{
    vars:{'--bg':'#f8fafc','--surface':'#ffffff','--surface2':'#f1f5f9','--surface3':'#e2e8f0',
      '--text':'#0f172a','--text-muted':'#64748b','--border':'rgba(100,116,139,0.22)',
      '--border-faint':'rgba(100,116,139,0.10)','--accent':'#6366f1','--accent-dim':'rgba(99,102,241,0.10)',
      '--critical':'#dc2626'},
    c:{bg:'#f8fafc',surface:'#ffffff',surface2:'#f1f5f9',text:'#0f172a',textMuted:'#64748b',
      grid:'rgba(100,116,139,0.12)',gridStrong:'rgba(100,116,139,0.28)',
      weekend:'rgba(100,116,139,0.06)',holiday:'rgba(239,68,68,0.07)',
      today:'#dc2626',critical:'#dc2626',progress:'rgba(0,0,0,0.20)',link:'#64748b',
      baseline:'rgba(100,116,139,0.55)'}
  }
};
// ── state ────────────────────────────────────────────────
const S={
  dayWidth:DATA.defaultDayWidth,
  zoomIdx:4,
  theme:DATA.theme,
  collapsed:new Set(DATA.rows.filter(r=>r.collapsed&&r.hasChildren).map(r=>r.id)),
  syncing:false,
  pan:false,      // sticky pan mode toggled by button
  _panTemp:false, // temporary pan via spacebar / middle-button
};
// ── date helpers ─────────────────────────────────────────
let DATES=[];
function initDates(){
  const dt=new Date(DATA.timeline.start+'T12:00:00Z');
  for(let i=0;i<DATA.timeline.totalDays;i++){
    DATES.push(dt.toISOString().slice(0,10));
    dt.setUTCDate(dt.getUTCDate()+1);
  }
}
function diffDays(a,b){
  return Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
}
function xFor(iso){
  return diffDays(DATA.timeline.start,iso)*S.dayWidth;
}
function tlWidth(){return DATA.timeline.totalDays*S.dayWidth;}
// ── visible rows ─────────────────────────────────────────
function buildRows(){
  const ch={};
  for(const r of DATA.rows)(ch[r.parentId||'__']=(ch[r.parentId||'__']||[])).push(r);
  const out=[];
  function walk(pid){
    for(const r of (ch[pid]||[])){out.push(r);if(r.hasChildren&&!S.collapsed.has(r.id))walk(r.id);}
  }
  walk('__');
  return out;
}
// ── theme ─────────────────────────────────────────────────
function applyTheme(){
  const p=PAL[S.theme];
  const root=document.documentElement;
  for(const[k,v]of Object.entries(p.vars))root.style.setProperty(k,v);
  document.body.style.background=p.vars['--bg'];
}
// ── grid HTML ─────────────────────────────────────────────
function escH(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
function renderGrid(rows){
  const gb=document.getElementById('grid-body');
  const parts=[];
  for(const row of rows){
    const ind=(row.depth*14);
    const cls='gr'+(row.isCritical?' crit':'')+(row.cancelled?' canc':'');
    const nameCls='gr-name'+(row.hasChildren?' bold':'')+(row.cancelled?' faint':'')+(row.isCritical?' crit':'');
    const tog=row.hasChildren
      ?'<button class="tog" data-t="'+row.id+'">'+(S.collapsed.has(row.id)?'&#9654;':'&#9660;')+'</button>'
      :'<span style="width:16px;flex-shrink:0"></span>';
    const ms=row.isMilestone?'<span style="font-size:9px;margin-right:2px">&#9670;</span>':'';
    parts.push(
      '<div class="'+cls+'" style="height:32px;display:flex;align-items:center;border-bottom:1px solid var(--border-faint)">'+
      '<div class="gr-name-cell" style="flex:1;min-width:0;display:flex;align-items:center;overflow:hidden;padding:0 4px;padding-left:'+(4+ind)+'px">'+
      tog+ms+
      '<span class="'+nameCls+'" title="'+escH(row.name)+(row.assigneeNames?' | '+escH(row.assigneeNames):'')+'">'+escH(row.name)+'</span>'+
      '</div>'+
      '<div class="gr-start">'+row.start+'</div>'+
      '<div class="gr-prog"><div class="pb"><div class="pf" style="width:'+row.progress+'%"></div></div></div>'+
      '</div>'
    );
  }
  gb.innerHTML=parts.join('');
}
// ── canvas setup ──────────────────────────────────────────
let BC,HC,BX,HX;
function initCanvas(){
  BC=document.getElementById('body-canvas');
  HC=document.getElementById('hdr-canvas');
  BX=BC.getContext('2d');
  HX=HC.getContext('2d');
}
function resizeCanvases(){
  const dpr=window.devicePixelRatio||1;
  const cb=document.getElementById('chart-body');
  const cp=document.getElementById('chart-pane');
  const vw=cb.clientWidth, vh=cb.clientHeight;
  const hw=cp.clientWidth;
  BC.width=Math.floor(vw*dpr); BC.height=Math.floor(vh*dpr);
  BC.style.width=vw+'px'; BC.style.height=vh+'px';
  HC.width=Math.floor(hw*dpr); HC.height=Math.floor(HDR_H*dpr);
  HC.style.width=hw+'px'; HC.style.height=HDR_H+'px';
}
// ── header draw ───────────────────────────────────────────
function drawHeader(sl){
  const dpr=window.devicePixelRatio||1;
  const p=PAL[S.theme].c;
  const ctx=HX;
  const w=HC.width/dpr, h=HDR_H;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=p.surface2; ctx.fillRect(0,0,w,h);
  ctx.strokeStyle=p.gridStrong; ctx.lineWidth=1;
  ctx.beginPath();
  ctx.moveTo(0,h-0.5);ctx.lineTo(w,h-0.5);
  ctx.moveTo(0,h/2-0.5);ctx.lineTo(w,h/2-0.5);
  ctx.stroke();
  const dw=S.dayWidth;
  const first=Math.max(0,Math.floor(sl/dw));
  const last=Math.min(DATA.timeline.totalDays-1,Math.ceil((sl+w)/dw));
  let lastMajor='';
  ctx.font='10px ui-sans-serif,system-ui'; ctx.textBaseline='middle';
  for(let d=first;d<=last;d++){
    const x=d*dw-sl;
    const iso=DATES[d]; if(!iso)continue;
    const dt=new Date(iso+'T00:00:00');
    const day=dt.getDate(), mon=dt.getMonth(), yr=dt.getFullYear(), dow=dt.getDay();
    // minor tick label
    let minor='';
    if(dw>=40) minor=day+'일';
    else if(dw>=14){if(dow===1)minor=(mon+1)+'/'+(day<10?'0':'')+day;}
    else if(dw>=4){if(day===1)minor=(mon+1)+'월';}
    else{if(day===1&&mon%3===0)minor=(mon+1)+'월';}
    if(minor){ctx.fillStyle=p.textMuted;ctx.fillText(minor,x+dw/2,h*0.75);}
    // major band
    let majorKey='', majorLbl='';
    if(dw>=4){majorKey=yr+'-'+(mon+1);majorLbl=yr+'년 '+(mon+1)+'월';}
    else{const q=Math.floor(mon/3)+1;majorKey=yr+'-Q'+q;majorLbl=yr+'년 Q'+q;}
    if(dw<4){majorKey=String(yr);majorLbl=yr+'년';}
    if(majorKey!==lastMajor){
      ctx.fillStyle=p.text;ctx.font='bold 10px ui-sans-serif,system-ui';
      ctx.fillText(majorLbl,x+4,h*0.25);
      ctx.font='10px ui-sans-serif,system-ui';
      ctx.strokeStyle=p.gridStrong;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(Math.floor(x)+0.5,0);ctx.lineTo(Math.floor(x)+0.5,h/2);ctx.stroke();
      lastMajor=majorKey;
    }
    // minor separator
    if(dw>=14&&(dw>=40||dow===1)){
      ctx.strokeStyle=p.grid;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(Math.floor(x)+0.5,h/2);ctx.lineTo(Math.floor(x)+0.5,h);ctx.stroke();
    }
  }
}
// ── body draw ─────────────────────────────────────────────
function roundRect(ctx,x,y,w,h,r){
  const rad=Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rad,y);ctx.arcTo(x+w,y,x+w,y+h,rad);ctx.arcTo(x+w,y+h,x,y+h,rad);
  ctx.arcTo(x,y+h,x,y,rad);ctx.arcTo(x,y,x+w,y,rad);ctx.closePath();
}
function drawBody(rows,sl,st){
  const dpr=window.devicePixelRatio||1;
  const p=PAL[S.theme].c;
  const ctx=BX;
  const vw=BC.width/dpr, vh=BC.height/dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.fillStyle=p.surface; ctx.fillRect(0,0,vw,vh);
  const dw=S.dayWidth;
  // weekend/holiday shading
  if(dw>=4){
    const hols=new Set(DATA.holidays), wknd=new Set(DATA.weekendDays);
    const f=Math.max(0,Math.floor(sl/dw)), l=Math.min(DATA.timeline.totalDays-1,Math.ceil((sl+vw)/dw));
    for(let d=f;d<=l;d++){
      const iso=DATES[d]; if(!iso)continue;
      const isHol=hols.has(iso), isWk=wknd.has(new Date(iso+'T00:00:00').getDay());
      if(!isHol&&!isWk)continue;
      ctx.fillStyle=isHol?p.holiday:p.weekend;
      ctx.fillRect(d*dw-sl,0,dw,vh);
    }
  }
  // row lines
  ctx.strokeStyle=p.grid; ctx.lineWidth=1;
  const fr=Math.floor(st/ROW_H), lr=Math.ceil((st+vh)/ROW_H);
  ctx.beginPath();
  for(let r=fr;r<=lr;r++){const y=Math.floor(r*ROW_H-st)+0.5;ctx.moveTo(0,y);ctx.lineTo(vw,y);}
  ctx.stroke();
  // vertical lines
  if(dw>=14){
    const f=Math.max(0,Math.floor(sl/dw)),l=Math.min(DATA.timeline.totalDays-1,Math.ceil((sl+vw)/dw));
    for(let d=f;d<=l;d++){
      const iso=DATES[d]; if(!iso)continue;
      const dt=new Date(iso+'T00:00:00'), isMon=dt.getDate()===1;
      if(!isMon&&dw<40)continue;
      ctx.strokeStyle=isMon?p.gridStrong:p.grid; ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(Math.floor(d*dw-sl)+0.5,0);ctx.lineTo(Math.floor(d*dw-sl)+0.5,vh);ctx.stroke();
    }
  }
  // today line
  if(DATA.today>=DATA.timeline.start&&DATA.today<=DATA.timeline.end){
    const tx=xFor(DATA.today)+dw/2-sl;
    ctx.strokeStyle=p.today;ctx.lineWidth=2;ctx.setLineDash([4,3]);
    ctx.beginPath();ctx.moveTo(tx,0);ctx.lineTo(tx,vh);ctx.stroke();ctx.setLineDash([]);
  }
  // markers
  for(const m of DATA.markers){
    if(m.date<DATA.timeline.start||m.date>DATA.timeline.end)continue;
    const mx=Math.round(xFor(m.date)+dw/2-sl);
    ctx.strokeStyle=m.color;ctx.lineWidth=2;ctx.setLineDash([6,3]);
    ctx.beginPath();ctx.moveTo(mx+0.5,0);ctx.lineTo(mx+0.5,vh);ctx.stroke();ctx.setLineDash([]);
    ctx.font='bold 10px ui-sans-serif,system-ui';
    const lw=ctx.measureText(m.label).width+6;
    ctx.fillStyle=m.color+'22';ctx.fillRect(mx+2,2,lw,14);
    ctx.fillStyle=m.color;ctx.textBaseline='top';ctx.fillText(m.label,mx+5,4);
  }
  // bars
  const rowMap={};
  rows.forEach((r,i)=>{rowMap[r.id]=i;});
  const vf=Math.max(0,Math.floor(st/ROW_H)-1), vl=Math.min(rows.length-1,Math.ceil((st+vh)/ROW_H)+1);
  ctx.font='11px ui-sans-serif,system-ui'; ctx.textBaseline='middle';
  for(let i=vf;i<=vl;i++){
    const row=rows[i]; if(!row)continue;
    const ry=i*ROW_H-st;
    const rx=xFor(row.start)-sl;
    // baseline ghost
    if(row.baselineStart){
      const bx=xFor(row.baselineStart)-sl;
      const bw=Math.max(dw,(diffDays(row.baselineStart,row.baselineEnd)+1)*dw);
      ctx.fillStyle=p.baseline; ctx.fillRect(bx,ry+ROW_H-6,bw,4);
    }
    if(row.isMilestone){
      const cx=rx+dw/2, cy=ry+ROW_H/2, r=BAR_H/2;
      ctx.fillStyle=row.barColor;
      if(row.cancelled)ctx.globalAlpha=0.4;
      ctx.beginPath();ctx.moveTo(cx,cy-r);ctx.lineTo(cx+r,cy);ctx.lineTo(cx,cy+r);ctx.lineTo(cx-r,cy);
      ctx.closePath();ctx.fill();ctx.globalAlpha=1;
      continue;
    }
    const rw=Math.max(dw,(diffDays(row.start,row.end)+1)*dw);
    const barY=ry+BAR_VPAD;
    if(row.cancelled)ctx.globalAlpha=0.45;
    if(row.hasChildren){
      ctx.fillStyle=row.isCritical?p.critical:p.text;
      ctx.fillRect(rx,barY+4,rw,BAR_H-8);ctx.fillRect(rx,barY,3,BAR_H);ctx.fillRect(rx+rw-3,barY,3,BAR_H);
    } else {
      ctx.fillStyle=row.barColor;
      roundRect(ctx,rx,barY,rw,BAR_H,4);ctx.fill();
      if(!row.cancelled&&row.progress>0){
        const pw=rw*Math.min(100,row.progress)/100;
        ctx.save();roundRect(ctx,rx,barY,rw,BAR_H,4);ctx.clip();
        ctx.fillStyle=p.progress;ctx.fillRect(rx,barY,pw,BAR_H);ctx.restore();
      }
    }
    ctx.globalAlpha=1;
    if(row.cancelled){
      ctx.strokeStyle=p.textMuted;ctx.lineWidth=1.5;ctx.setLineDash([5,3]);
      ctx.beginPath();ctx.moveTo(rx,barY+BAR_H/2);ctx.lineTo(rx+rw,barY+BAR_H/2);ctx.stroke();ctx.setLineDash([]);
    }
    if(dw>=6){ctx.fillStyle=p.textMuted;ctx.fillText(row.name,rx+rw+6,ry+ROW_H/2,180);}
  }
  // dependencies
  ctx.lineWidth=1.5;
  for(const dep of DATA.deps){
    const fi=rowMap[dep.fromId],ti=rowMap[dep.toId];
    if(fi===undefined||ti===undefined)continue;
    const fr2=rows[fi],to=rows[ti];
    const feX=xFor(fr2.end)+dw-sl, fsX=xFor(fr2.start)-sl;
    const tsX=xFor(to.start)-sl, teX=xFor(to.end)+dw-sl;
    const fy=fi*ROW_H-st+ROW_H/2, ty2=ti*ROW_H-st+ROW_H/2;
    let sx=feX,tx2=tsX;
    if(dep.type==='SS'){sx=fsX;tx2=tsX;}
    else if(dep.type==='FF'){sx=feX;tx2=teX;}
    else if(dep.type==='SF'){sx=fsX;tx2=teX;}
    ctx.strokeStyle=p.link;
    const gap=10;
    const midX=dep.type==='FS'?Math.max(sx+gap,tx2-gap):sx+(dep.type==='SS'?-gap:gap);
    ctx.beginPath();ctx.moveTo(sx,fy);ctx.lineTo(midX,fy);ctx.moveTo(midX,fy);ctx.lineTo(midX,ty2);ctx.moveTo(midX,ty2);ctx.lineTo(tx2,ty2);ctx.stroke();
    const dir=(dep.type==='FF'||dep.type==='SF')?-1:1;
    ctx.fillStyle=p.link;ctx.beginPath();ctx.moveTo(tx2,ty2);ctx.lineTo(tx2-dir*4,ty2-4);ctx.lineTo(tx2-dir*4,ty2+4);ctx.closePath();ctx.fill();
  }
}
// ── main draw ──────────────────────────────────────────────
let raf=false;
function qDraw(){if(raf)return;raf=true;requestAnimationFrame(()=>{raf=false;draw();});}
function draw(){
  const rows=buildRows();
  const cs=document.getElementById('chart-scroll');
  const sl=cs.scrollLeft, st=cs.scrollTop;
  const contentH=rows.length*ROW_H+48;
  document.getElementById('chart-spacer').style.cssText='width:'+tlWidth()+'px;height:'+contentH+'px';
  renderGrid(rows);
  const gb=document.getElementById('grid-body');
  if(Math.abs(gb.scrollTop-st)>0.5){S.syncing=true;gb.scrollTop=st;S.syncing=false;}
  resizeCanvases();
  drawHeader(sl);
  drawBody(rows,sl,st);
  document.getElementById('zoom-lbl').textContent=ZOOM_LBLS[S.zoomIdx]||'';
}
// ── scroll sync ────────────────────────────────────────────
function setupScroll(){
  const cs=document.getElementById('chart-scroll');
  const gb=document.getElementById('grid-body');
  cs.addEventListener('scroll',()=>{
    if(!S.syncing){S.syncing=true;gb.scrollTop=cs.scrollTop;S.syncing=false;}
    drawHeader(cs.scrollLeft);
    drawBody(buildRows(),cs.scrollLeft,cs.scrollTop);
  },{passive:true});
  gb.addEventListener('scroll',()=>{
    if(!S.syncing){S.syncing=true;cs.scrollTop=gb.scrollTop;S.syncing=false;}
  },{passive:true});
}
// ── toolbar ────────────────────────────────────────────────
function setupToolbar(){
  document.getElementById('btn-zi').onclick=()=>{
    if(S.zoomIdx<ZOOM_STEPS.length-1){S.zoomIdx++;S.dayWidth=ZOOM_STEPS[S.zoomIdx];qDraw();}
  };
  document.getElementById('btn-zo').onclick=()=>{
    if(S.zoomIdx>0){S.zoomIdx--;S.dayWidth=ZOOM_STEPS[S.zoomIdx];qDraw();}
  };
  document.getElementById('btn-today').onclick=()=>{
    const x=Math.max(0,xFor(DATA.today)-80);
    document.getElementById('chart-scroll').scrollLeft=x;
  };
  document.getElementById('btn-theme').onclick=()=>{
    S.theme=S.theme==='dark'?'light':'dark';applyTheme();qDraw();
  };
  document.getElementById('btn-exp').onclick=()=>{S.collapsed.clear();qDraw();};
  document.getElementById('btn-col').onclick=()=>{
    for(const r of DATA.rows)if(r.hasChildren)S.collapsed.add(r.id);
    qDraw();
  };
}
// ── collapse toggle ────────────────────────────────────────
function setupToggle(){
  document.getElementById('grid-body').addEventListener('click',e=>{
    const btn=e.target.closest('[data-t]');
    if(!btn)return;
    const id=btn.dataset.t;
    if(S.collapsed.has(id))S.collapsed.delete(id);else S.collapsed.add(id);
    qDraw();
  });
}
// ── resizer ────────────────────────────────────────────────
function setupResizer(){
  const rz=document.getElementById('resizer'),gp=document.getElementById('grid-pane');
  let sx=0,sw=0,on=false;
  rz.addEventListener('mousedown',e=>{on=true;sx=e.clientX;sw=gp.offsetWidth;rz.classList.add('drag');e.preventDefault();});
  document.addEventListener('mousemove',e=>{
    if(!on)return;
    gp.style.width=Math.max(160,Math.min(600,sw+e.clientX-sx))+'px';
    qDraw();
  });
  document.addEventListener('mouseup',()=>{on=false;rz.classList.remove('drag');});
}
// ── pan / hand drag ────────────────────────────────────────
function panActive(){return S.pan||S._panTemp;}
function updatePanCursor(){
  const cs=document.getElementById('chart-scroll');
  cs.classList.toggle('pan',panActive());
  const btn=document.getElementById('btn-pan');
  btn.classList.toggle('active',S.pan);
}
function setupPan(){
  const cs=document.getElementById('chart-scroll');
  let dragging=false, lastX=0, lastY=0;
  // left-button drag when pan mode is active
  cs.addEventListener('mousedown',e=>{
    if(e.button===0&&!panActive())return;
    if(e.button===2)return;           // ignore right-click
    dragging=true;lastX=e.clientX;lastY=e.clientY;
    cs.classList.add('panning');
    e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{
    if(!dragging)return;
    cs.scrollLeft-=e.clientX-lastX;
    cs.scrollTop -=e.clientY-lastY;
    lastX=e.clientX;lastY=e.clientY;
  });
  document.addEventListener('mouseup',e=>{
    if(!dragging)return;
    dragging=false;
    cs.classList.remove('panning');
    // if temp-pan via middle button, release it
    if(e.button===1){S._panTemp=false;updatePanCursor();}
  });
  // middle mouse button activates temp pan
  cs.addEventListener('mousedown',e=>{
    if(e.button!==1)return;
    S._panTemp=true;updatePanCursor();
    dragging=true;lastX=e.clientX;lastY=e.clientY;
    cs.classList.add('panning');
    e.preventDefault();
  });
  // spacebar: hold for temp pan, release to restore
  let spaceHeld=false;
  document.addEventListener('keydown',e=>{
    if(e.code==='Space'&&!spaceHeld&&document.activeElement===document.body){
      spaceHeld=true;S._panTemp=true;updatePanCursor();e.preventDefault();
    }
  });
  document.addEventListener('keyup',e=>{
    if(e.code==='Space'){spaceHeld=false;S._panTemp=false;if(!dragging)cs.classList.remove('panning');updatePanCursor();}
  });
  // toolbar button
  document.getElementById('btn-pan').onclick=()=>{
    S.pan=!S.pan;updatePanCursor();
  };
}
// ── init ───────────────────────────────────────────────────
function init(){
  initDates();
  applyTheme();
  document.getElementById('proj-title').textContent=DATA.projectName;
  document.getElementById('exp-date').textContent='내보내기: '+DATA.today;
  S.zoomIdx=ZOOM_STEPS.reduce((b,v,i)=>Math.abs(v-DATA.defaultDayWidth)<Math.abs(ZOOM_STEPS[b]-DATA.defaultDayWidth)?i:b,4);
  S.dayWidth=ZOOM_STEPS[S.zoomIdx];
  initCanvas();
  setupScroll();
  setupToolbar();
  setupToggle();
  setupResizer();
  setupPan();
  draw();
  // scroll to today
  setTimeout(()=>{
    const x=Math.max(0,xFor(DATA.today)-100);
    document.getElementById('chart-scroll').scrollLeft=x;
  },80);
  window.addEventListener('resize',()=>{resizeCanvases();qDraw();});
}
document.addEventListener('DOMContentLoaded',init);
</script>
</body>
</html>`;
}
