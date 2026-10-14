'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const SHA256='eaaed1e636d01c8539e1c206ba72898fa25ec140d2908d753976cc12c97a6458';
function loadCapture(platform=process.platform,arch=process.arch){
  if(platform==='linux')return require('./capture-linux.cjs').loadLinuxCapture();
  if(platform!=='win32')return null;
  if(arch!=='x64')throw new Error('Windows per-app capture currently requires x64. No ARM64 native binary has been verified.');
  const file=path.join(__dirname,'win32-x64','addon.node');
  if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==SHA256)throw new Error('Native audio addon checksum mismatch. Re-extract the verified bundle.');
  const addon=require(file);
  for(const key of ['getVisibleWindows','startLoopbackCapture','stopLoopbackCapture'])if(typeof addon[key]!=='function')throw new Error('Native audio addon API mismatch: '+key);
  return addon;
}
module.exports={loadCapture,SHA256};
