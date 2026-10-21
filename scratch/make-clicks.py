# a kick every 0.5 s (120 bpm) for 60 s: the ground truth for latency measurements
import numpy as np, wave, sys
sr=48000; dur=60; bpm=float(sys.argv[2]) if len(sys.argv)>2 else 120
x=np.zeros(sr*dur)
per=60/bpm; t=np.arange(int(.15*sr))/sr
kick=np.sin(2*np.pi*(50+90*np.exp(-t*40))*t)*np.exp(-t*18)*.8
kick[:48]+=np.random.default_rng(1).normal(0,.4,48)*np.linspace(1,0,48)
start=1.0; n=0
while start+n*per+0.15<dur:
    i=int(round((start+n*per)*sr)); x[i:i+len(kick)]+=kick; n+=1
w=wave.open(sys.argv[1],'wb'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((np.clip(x,-1,1)*32767).astype('<i2').tobytes()); w.close()
print(n,'kicks, first at',start,'s, period',per)
