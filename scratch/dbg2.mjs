import fs from 'node:fs';
import { parseBrain, FlyBrain } from '../brain/lif.mjs';
const meta = JSON.parse(fs.readFileSync('data/brain.json','utf8')); const buf = fs.readFileSync('data/brain.bin');
const b = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), meta);
const earGain = +(process.argv[2]||1), hz=+(process.argv[3]||150), which=process.argv[4]||'AB';
const groups = which==='all' ? ['JO-A','JO-B','JO-C','JO-D','JO-E','JO-F'] : ['JO-A','JO-B'];
const ids=Uint32Array.from(groups.flatMap(g=>[...b.groups[g]]));
const fly=new FlyBrain(b,{dt:0.5});
for(const i of ids) for(let e=b.rowPtr[i];e<b.rowPtr[i+1];e++) fly.wmv[e]*=earGain;
fly.setDrive(ids,new Float32Array(ids.length).fill(hz));
const isJ=new Uint8Array(b.N); for(const i of ids) isJ[i]=1;
const t0=performance.now(); fly.run(1000); const wall=performance.now()-t0;
let nonJ=0, firing=0; const byCls=new Map(); const top=[];
for(let i=0;i<b.N;i++){ if(isJ[i])continue; const c=fly.spikeCount[i]; if(c){nonJ+=c;firing++; const k=meta.superClass[b.cls[i]]; byCls.set(k,(byCls.get(k)||0)+c); top.push([c,i]);} }
top.sort((x,y)=>y[0]-x[0]);
console.log(`ear ${which} gain ${earGain} @${hz}Hz | wall ${wall.toFixed(0)}ms for 1s | drive spikes ~${(ids.length*hz)} | non-ear spikes ${nonJ} from ${firing} neurons | active ${fly.nActive}`);
console.log(' by class:', [...byCls.entries()].sort((x,y)=>y[1]-x[1]).map(([k,v])=>`${k}=${v}`).join(' '));
console.log(' top:', top.slice(0,12).map(([c,i])=>`${meta.types[i]}:${c}`).join(' '));
const G=b.groups; console.log(' rates: AMMC',fly.groupRate(G.AMMC).toFixed(1),'WED',fly.groupRate(G.WED).toFixed(1),'pC1',fly.groupRate(G.pC1).toFixed(1),'pC2l',fly.groupRate(G.pC2l).toFixed(1),'KC',fly.groupRate(G.KC).toFixed(2),'MBON',fly.groupRate(G.MBON).toFixed(1),'DN',fly.groupRate(G.DN).toFixed(2),'EPG',fly.groupRate(G.EPG).toFixed(1),'PAM',fly.groupRate(G.PAM).toFixed(1),'motor',fly.groupRate(G.motor).toFixed(1));
