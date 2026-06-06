/**
 * Chrome DOM observation via JXA (JavaScript for Automation).
 *
 * Uses `osascript -l JavaScript` → Chrome scripting bridge.
 * Two paths:
 *   Path A — tab.execute(observer JS) for full DOM observation.
 *     Requires Chrome: View > Developer > Allow JavaScript from Apple Events.
 *   Path B — tab.url() / tab.name() as fallback.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

import type { ComputerUseConfig } from './config.js'
import type { ChromeDomObservation } from './types.js'

import { runProcess } from './process.js'

// ---------------------------------------------------------------------------
// DOM observer JS executed inside Chrome's active tab.
// Must be compact and use only ES5-compatible patterns that JXA's
// tab.execute() can round-trip without truncation or type-mapping issues.
// ---------------------------------------------------------------------------

function domObserverJs(): string {
  // Build as a single expression to avoid JXA return-type issues.
  return `(function(){
  var MAX=300, MAXTEXT=30000;
  var vp={w:window.innerWidth,h:window.innerHeight,sx:window.scrollX,sy:window.scrollY};
  var texts=[];

  function text(el){if(!el)return'';var v=el.innerText;return typeof v==='string'?v.replace(/\\s+/g,' ').trim():(el.textContent||'').replace(/\\s+/g,' ').trim();}

  function role(el,tag){
    var r=el.getAttribute('role');if(r)return r;
    if(tag==='a'&&el.href)return'link';
    if(tag==='button'||tag==='summary')return'button';
    if(tag==='textarea')return'textbox';
    if(tag==='select')return el.multiple?'listbox':'combobox';
    if(tag==='input'){var t=el.type;if(t==='button'||t==='submit'||t==='reset')return'button';if(t==='checkbox')return'checkbox';if(t==='radio')return'radio';if(t==='range')return'slider';if(t==='search')return'searchbox';return'textbox';}
    if(tag==='img')return'img';
    if(/^h[1-6]/.test(tag))return'heading';
    return{main:'main',nav:'navigation',header:'banner',footer:'contentinfo',aside:'complementary',article:'article',form:'form',section:'region'}[tag]||'generic';
  }

  function name(el,tag){
    var doc=el.ownerDocument||document;
    var v=el.getAttribute('aria-labelledby');if(v){var t2=v.split(/\\s+/).map(function(id){return text(doc.getElementById(id));}).filter(Boolean).join(' ');if(t2)return t2;}
    v=el.getAttribute('aria-label');if(v)return v.replace(/\\s+/g,' ').trim();
    if(tag==='img'&&el.alt)return el.alt.replace(/\\s+/g,' ').trim();
    if(el.id){var lbl=doc.querySelector('label[for="'+(typeof CSS!=='undefined'&&CSS.escape?CSS.escape(el.id):el.id.replace(/"/g,'\\\\"'))+'"]');var lt=text(lbl);if(lt)return lt;}
    var cl=text(el.closest('label'));if(cl)return cl;
    v=el.getAttribute('title');if(v)return v.replace(/\\s+/g,' ').trim();
    v=el.getAttribute('placeholder');if(v)return v.replace(/\\s+/g,' ').trim();
    if('value'in el&&tag!=='button'&&el.value)return String(el.value).replace(/\\s+/g,' ').trim();
    var tx=text(el);if(tx)return tx;
    return'';
  }

  function actionable(el,tag,r){
    if('disabled'in el&&el.disabled)return false;
    return tag==='a'||tag==='button'||tag==='input'||tag==='textarea'||tag==='select'||tag==='summary'||['button','link','checkbox','radio','textbox','searchbox','combobox','listbox','menuitem','tab'].indexOf(r)!==-1;
  }

  var sel='a[href],button,input,textarea,select,summary,[role],[aria-label],[aria-labelledby],[tabindex]:not([tabindex="-1"]),h1,h2,h3,h4,h5,h6,main,nav,header,footer,aside,article,section,form,label,img[alt]';
  var elements=[];

  function collectText(doc){try{var t=(doc.body&&doc.body.innerText||doc.documentElement&&doc.documentElement.innerText||'').replace(/\\s+/g,' ').trim();if(t)texts.push(t);}catch(e){}}

  function scanDocument(doc,win,ox,oy,prefix){
    try{
      Array.from(doc.querySelectorAll(sel)).forEach(function(el,i){
        if(elements.length>=MAX)return;
        var tag=el.tagName.toLowerCase();
        var style=win.getComputedStyle(el);
        if(el.hidden||el.getAttribute('aria-hidden')==='true'||style.display==='none'||style.visibility==='hidden'||style.opacity==='0'||(tag==='input'&&el.type==='hidden'))return;

        var rects=el.getClientRects();var rect=null;
        for(var r=0;r<rects.length;r++){if(rects[r].width>0&&rects[r].height>0){rect=rects[r];break;}}
        if(!rect){var br=el.getBoundingClientRect();if(br.width<=0||br.height<=0)return;rect=br;}

        var box={x:Math.max(rect.x,0),y:Math.max(rect.y,0),w:Math.min(rect.x+rect.width,win.innerWidth)-Math.max(rect.x,0),h:Math.min(rect.y+rect.height,win.innerHeight)-Math.max(rect.y,0)};
        if(box.w<2||box.h<2)return;

        var cx=box.x+box.w/2,cy=box.y+box.h/2;
        var top=doc.elementFromPoint(cx,cy);
        if(!top||(top!==el&&!el.contains(top)))return;

        var rl=role(el,tag),nm=name(el,tag),tx=text(el),ac=actionable(el,tag,rl);
        if(!ac&&!nm&&rl==='generic'&&tag!=='label')return;

        var gbox={x:ox+box.x,y:oy+box.y,w:box.w,h:box.h};
        elements.push({id:prefix+'-'+(el.id||'e'+i),tag:tag,role:rl,name:nm,text:tx,hr:tag==='a'?el.href:null,bx:gbox,cx:ox+cx,cy:oy+cy,cf:Math.min(1,+(0.25+(rl!=='generic'?0.2:0)+(nm?0.25:0)+(ac?0.15:0)).toFixed(2)),ac:ac,st:el.disabled?{disabled:true}:{}});
      });
    }catch(e){}
  }

  collectText(document);
  scanDocument(document,window,0,0,'top');
  Array.from(document.querySelectorAll('iframe')).forEach(function(frame,fi){
    try{
      var frameRect=frame.getBoundingClientRect();
      if(frameRect.width<2||frameRect.height<2)return;
      var frameStyle=window.getComputedStyle(frame);
      if(frame.hidden||frameStyle.display==='none'||frameStyle.visibility==='hidden'||frameStyle.opacity==='0')return;
      var fdoc=frame.contentDocument, fwin=frame.contentWindow;
      if(!fdoc||!fwin)return;
      collectText(fdoc);
      scanDocument(fdoc,fwin,frameRect.x,frameRect.y,'f'+fi);
    }catch(e){}
  });

  var bodyText=texts.join(' ').replace(/\\s+/g,' ').trim();

  var signals=[];
  var low=bodyText.toLowerCase();
  if(low.indexOf('captcha')!==-1)signals.push('captcha');
  var loginRequiredPattern=/(please )?(sign in|log in|login|create an account|create account|register).{0,40}(to continue|before continuing|required)|(to continue).{0,40}(sign in|log in|login|required)/;
  if(loginRequiredPattern.test(low))signals.push('login_required');
  if(low.indexOf('too many requests')!==-1||low.indexOf('rate limit')!==-1)signals.push('rate_limited');

  return JSON.stringify({url:window.location.href,title:document.title||window.location.href,oat:new Date().toISOString(),vp:vp,vt:bodyText.slice(0,MAXTEXT),el:elements,sg:signals,te:elements.length>=MAX,tv:bodyText.length>MAXTEXT});
})()`
}

// ---------------------------------------------------------------------------
// JXA orchestration script — tries tab.execute(), falls back to url+title
// ---------------------------------------------------------------------------

function jxaCaptureScript(observerJs: string): string {
  return `
var chrome = Application('Google Chrome');
if (!chrome.running()) { JSON.stringify({ ok: false, reason: 'chrome_not_running' }); }
var windows = chrome.windows();
if (!windows || windows.length === 0) { JSON.stringify({ ok: false, reason: 'no_windows' }); }

var tab = windows[0].activeTab();

try {
  var raw = tab.execute({ javascript: ${JSON.stringify(observerJs)} });
  if (raw === null || raw === undefined) throw new Error('execute returned null');
  var data = JSON.parse(raw);
  JSON.stringify({ ok: true, method: 'execute', data: data });
} catch(e) {
  try {
    JSON.stringify({
      ok: true, method: 'direct',
      data: {
        url: tab.url() || 'about:blank',
        title: tab.name() || (tab.url() || 'about:blank'),
        oat: new Date().toISOString(),
        vp: null, vt: '', el: [], sg: [], te: false, tv: false
      }
    });
  } catch(e2) {
    JSON.stringify({ ok: false, reason: 'tab_failed', error: e2.message });
  }
}
`
}

function directTabCaptureScript(): string {
  return `
(function(){
  var chrome = Application('Google Chrome');
  if (!chrome.running()) {
    return JSON.stringify({ ok: false, reason: 'chrome_not_running' });
  }
  var windows = chrome.windows();
  if (!windows || windows.length === 0) {
    return JSON.stringify({ ok: false, reason: 'no_windows' });
  }
  var tab = windows[0].activeTab();
  var url = tab.url() || 'about:blank';
  return JSON.stringify({
    ok: true,
    method: 'direct_outer_fallback',
    data: {
      url: url,
      title: tab.name() || url,
      oat: new Date().toISOString(),
      vp: null,
      vt: '',
      el: [],
      sg: [],
      te: false,
      tv: false
    }
  });
})()
`
}

// ---------------------------------------------------------------------------
// Raw JSON types (compact field names from the observer JS)
// ---------------------------------------------------------------------------

interface RawDomData {
  url: string
  title: string
  oat: string
  vp?: { w: number, h: number, sx: number, sy: number } | null
  vt: string
  el: Array<{
    id: string
    tag: string
    role: string
    name: string
    text: string
    hr: string | null
    bx: { x: number, y: number, w: number, h: number }
    cx: number
    cy: number
    cf: number
    ac: boolean
    st: Record<string, unknown>
  }>
  sg: string[]
  te: boolean
  tv: boolean
}

interface JxaResult {
  ok: boolean
  method?: string
  reason?: string
  error?: string
  data?: RawDomData
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function captureChromeDom(
  config: ComputerUseConfig,
): Promise<ChromeDomObservation | null> {
  if (process.platform !== 'darwin')
    return null

  const jxaScript = jxaCaptureScript(domObserverJs())

  const tempDir = await mkdtemp(join(tmpdir(), 'careerdeepseek-chrome-dom-'))
  const scriptPath = join(tempDir, 'capture.js')

  try {
    await writeFile(scriptPath, jxaScript, 'utf-8')

    const result = await runProcess(
      config.binaries.osascript,
      ['-l', 'JavaScript', scriptPath],
      { timeoutMs: config.timeoutMs },
    )

    if (!result.stdout || result.exitCode !== 0)
      return await captureChromeDirectTab(config)

    const jxaResult = JSON.parse(result.stdout.trim()) as JxaResult
    if (!jxaResult.ok || !jxaResult.data)
      return await captureChromeDirectTab(config)

    return rawDomToObservation(jxaResult.data)
  }
  catch {
    return await captureChromeDirectTab(config)
  }
  finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function captureChromeDirectTab(config: ComputerUseConfig): Promise<ChromeDomObservation | null> {
  const result = await runProcess(
    config.binaries.osascript,
    ['-l', 'JavaScript', '-e', directTabCaptureScript()],
    { timeoutMs: config.timeoutMs },
  )

  if (!result.stdout || result.exitCode !== 0)
    return null

  try {
    const jxaResult = JSON.parse(result.stdout.trim()) as JxaResult
    if (!jxaResult.ok || !jxaResult.data)
      return null
    return rawDomToObservation(jxaResult.data)
  }
  catch {
    return null
  }
}

function rawDomToObservation(raw: RawDomData): ChromeDomObservation {
  return {
    url: raw.url,
    title: raw.title,
    observedAt: raw.oat,
    visibleText: raw.vt,
    elements: (raw.el || []).map(el => ({
      id: el.id,
      tagName: el.tag,
      role: el.role,
      name: el.name,
      text: el.text,
      href: el.hr,
      bounds: { x: el.bx.x, y: el.bx.y, width: el.bx.w, height: el.bx.h },
      center: { x: el.cx, y: el.cy },
      confidence: el.cf,
      actionable: el.ac,
      states: el.st,
    })),
    signals: raw.sg || [],
  }
}
