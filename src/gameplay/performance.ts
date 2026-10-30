export interface FrameSample { ms:number; elapsed:number; scene:string }
export class FrameMetrics {
 samples:FrameSample[]=[]; private last:number|null=null;
 reset(){this.samples=[];this.last=null;}
 frame(timestamp:number,active:boolean,elapsed:number,scene:string){if(!active){this.last=null;return;}if(this.last!==null){const ms=timestamp-this.last;if(ms>0)this.samples.push({ms,elapsed,scene});}this.last=timestamp;}
 report(){const ms=this.samples.map(s=>s.ms).sort((a,b)=>a-b),sum=ms.reduce((a,b)=>a+b,0),percentile=(p:number)=>ms[Math.min(ms.length-1,Math.max(0,Math.ceil(ms.length*p)-1))]??0;return {activeSeconds:sum/1000,frames:ms.length,averageFPS:sum?ms.length/(sum/1000):0,p95:percentile(.95),p99:percentile(.99),worst:ms.at(-1)??0,longFrames:this.samples.filter(s=>s.ms>=100),scenes:[...new Set(this.samples.map(s=>s.scene))],exclusions:'Only explicit pause, loading, non-playing pages, and document.hidden. All active first effects and long frames retained.'};}
}
