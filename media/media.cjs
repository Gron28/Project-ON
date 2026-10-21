'use strict';
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const text = (v, n = 240) => typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n) : '';
function selectSession(sessions, source) {
  if (!source) return null;
  let candidates = Array.isArray(sessions) ? sessions.slice(0,32).filter(s=>s && text(s.title) && ['Playing','Paused','Stopped'].includes(s.status)) : [];
  if (source.kind === 'app') {
    const app = text(source.name).toLowerCase().replace(/\.exe$/,'');
    candidates = candidates.filter(s => text(s.app).toLowerCase().replace(/\.exe$/,'') === app || text(s.app).toLowerCase().startsWith(app+'.') || text(s.app).toLowerCase().startsWith(app+'_'));
  }
  const playing = candidates.filter(s=>s.status === 'Playing');
  const selected = playing.length === 1 ? playing[0] : !playing.length && candidates.length === 1 ? candidates[0] : null;
  if (!selected) return { notice: candidates.length > 1 ? 'Multiple media sessions: track attribution is ambiguous. Use manual song markers.' : 'No matching media metadata. Use manual song markers.' };
  return { title:text(selected.title), artist:text(selected.artist), album:text(selected.album), albumArtist:text(selected.albumArtist), provider:text(selected.app,100), status:selected.status,
    key:[text(selected.app),text(selected.trackId,400)||text(selected.title)+'|'+text(selected.artist)].join('|'), position:Number.isFinite(selected.position)?selected.position:null,
    notice: source.kind === 'system' ? 'Media-session title associated with mixed system audio, not isolated song audio.' : 'Matched media-session metadata for the selected application.' };
}
function startMediaMonitor(onUpdate, platform=process.platform, deps={}) {
  const spawnChild=deps.spawn||spawn, execute=deps.execFile||execFile;
  const interval=deps.setInterval||setInterval, clear=deps.clearInterval||clearInterval;
  const later=deps.setTimeout||setTimeout,cancel=deps.clearTimeout||clearTimeout,now=deps.now||Date.now;
  let child=null,timer=null,retry=null,stopped=false,busy=false,latest=[],updated=0,message='Track metadata unavailable.',failures=0;
  const emit=()=>{if(!stopped)onUpdate({sessions:now()-updated<7000?latest:[],notice:message});};
  if(platform==='win32') {
    const start=()=>{
      if(stopped)return;let buf='',lastLine=now(),failed=false;
      const proc=spawnChild(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'windows-media.ps1')],{windowsHide:true,stdio:['ignore','pipe','ignore']});child=proc;
      const fail=()=>{if(stopped||failed||proc!==child)return;failed=true;clear(timer);timer=null;child=null;latest=[];message='Windows media metadata unavailable; retrying automatically. Use manual song markers meanwhile.';emit();proc.kill();retry=later(()=>{retry=null;start();},Math.min(30000,1000*2**Math.min(failures++,5)));};
      proc.stdout.setEncoding('utf8');
      proc.stdout.on('data',chunk=>{
        if(stopped||failed||proc!==child)return;buf+=chunk;if(buf.length>65536){fail();return;}
        let i;while((i=buf.indexOf('\n'))>=0){const line=buf.slice(0,i).trim();buf=buf.slice(i+1);try{const v=JSON.parse(line);latest=Array.isArray(v.sessions)?v.sessions:[];updated=now();lastLine=updated;message=text(v.error)||'Windows media sessions';if(!v.error)failures=0;emit();}catch{}}
      });
      proc.on('error',fail);proc.on('exit',fail);
      timer=interval(()=>{if(now()-lastLine>10000)fail();else emit();},2000);
    };start();
  } else if(platform==='linux') {
    const poll=()=>{
      if(busy||stopped)return;busy=true;
      const format=['{{playerInstance}}','{{status}}','{{title}}','{{artist}}','{{mpris:trackid}}','{{position}}','{{xesam:album}}','{{xesam:albumArtist}}'].join('\x1f');
      child=execute('playerctl',['--all-players','metadata','--format',format],{timeout:1800,maxBuffer:65536,encoding:'utf8'},(err,out)=>{
        busy=false;if(stopped)return;
        if(err){latest=[];message=err.code==='ENOENT'?'Install optional playerctl for automatic track titles; manual markers work without it.':'No available MPRIS media metadata. Use manual song markers.';}
        else{latest=out.trim().split('\n').map(line=>line.split('\x1f')).filter(f=>f.length===8).map(f=>({app:f[0],status:f[1],title:f[2],artist:f[3],trackId:f[4],position:Number(f[5])/1e6,album:f[6],albumArtist:f[7]}));message='Linux MPRIS media sessions';}
        updated=now();emit();
      });
    };poll();timer=interval(poll,2000);
  }else emit();
  return ()=>{stopped=true;clear(timer);cancel(retry);child?.kill();child=null;};
}

module.exports={selectSession,startMediaMonitor};
