import fs from 'node:fs';
import { parseBrain, FlyBrain, mulberry32 } from '../brain/lif.mjs';
const meta = JSON.parse(fs.readFileSync('data/brain.json','utf8')); const buf = fs.readFileSync('data/brain.bin');
const b = parseBrain(buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength), meta);
const earGain=+(process.argv[2]||3), eyeHz=+(process.argv[3]||20), earHz=+(process.argv[4]||100), seconds=+(process.argv[5]||1);
const ear=Uint32Array.from(['JO-A','JO-B','JO-C','JO-D','JO-E','JO-F'].flatMap(g=>[...b.groups[g]]));
const eye=b.groups['sensory-photo_receptor'];
const fly=new FlyBrain(b,{dt:0.5});
for(const i of ear) for(let e=b.rowPtr[i];e<b.rowPtr[i+1];e++) fly.wmv[e]*=earGain;
const ids=Uint32Array.from([...ear,...eye]); const rates=new Float32Array(ids.length);
const rng=mulberry32(7); rates.fill(earHz,0,ear.length); for(let k=ear.length;k<ids.length;k++) rates[k]=eyeHz*2*rng();  // a static image: some bright, some dark
fly.setDrive(ids,rates);
const isS=new Uint8Array(b.N); for(const i of ids) isS[i]=1;
const t0=performance.now(); for(let s=0;s<seconds;s++){ fly.run(1000); /* flicker the image every second */ for(let k=ear.length;k<ids.length;k++) rates[k]=eyeHz*2*rng(); } const wall=performance.now()-t0;
let nonS=0, firing=0; const byCls=new Map();
for(let i=0;i<b.N;i++){ if(isS[i])continue; const c=fly.spikeCount[i]; if(c){nonS+=c;firing++; const k=meta.superClass[b.cls[i]]; byCls.set(k,(byCls.get(k)||0)+c);} }
console.log(`ear gain ${earGain} @${earHz}Hz + eye @~${eyeHz}Hz | wall ${(wall/seconds).toFixed(0)} ms per brain-second | speed ${(seconds*1000/wall).toFixed(2)}x | non-sensory spikes/s ${(nonS/seconds)|0} from ${firing} neurons | active ${fly.nActive}`);
console.log(' by class:', [...byCls.entries()].sort((x,y)=>y[1]-x[1]).map(([k,v])=>`${k}=${(v/seconds)|0}`).join(' '));
const G=b.groups; const r=n=>fly.groupRate(G[n]).toFixed(1);
console.log(` rates: AMMC ${r('AMMC')} WED ${r('WED')} pC1 ${r('pC1')} KC ${r('KC')} KCg ${r('KCg')} MBON ${r('MBON')} PAM ${r('PAM')} PPL1 ${r('PPL1')} DN ${r('DN')} DN-left ${r('DN-left')} DN-right ${r('DN-right')} EPG ${r('EPG')} PEN ${r('PEN')} hDelta ${r('hDelta')} dFB ${r('dFB')} clock ${r('clock')} motor ${r('motor')} endocrine ${r('endocrine')}`);
