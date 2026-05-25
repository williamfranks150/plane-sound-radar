'use strict';

function resizeCanvas(){
  const c=$('radar');
  const wrap=c.parentElement;
  const dpr=window.devicePixelRatio||1;
  const vv=window.visualViewport?.height||window.innerHeight;
  const app=document.querySelector('.app');
  const nonRadar=[...app.children].filter(el=>el!==wrap&&!el.classList.contains('hidden'));
  const used=nonRadar.reduce((s,el)=>s+el.getBoundingClientRect().height,0)+(nonRadar.length+1)*6+16;
  const availH=Math.max(280,vv-used);
  const w=Math.floor(Math.max(280,wrap.clientWidth-8));
  const h=Math.floor(availH);
  c.width=Math.floor(w*dpr);
  c.height=Math.floor(h*dpr);
  c.style.width=w+'px';
  c.style.height=h+'px';
}

function drawRadar(){
  const c=$('radar');
  const dpr=window.devicePixelRatio||1;
  const ctx=c.getContext('2d');
  const W=c.width/dpr,H=c.height/dpr;
  const cx=W/2,cy=H/2;
  const pad=18;

  // Use one uniform scale so radar geometry stays true circular.
  // gridR is kept inside the panel so the outer radar rings are never clipped.
  // effectR reaches the farthest panel corner so glow/sweep still fill the rectangle.
  const farR=Math.hypot(Math.max(cx,W-cx),Math.max(cy,H-cy))+18;
  const effectR=Math.max(120,farR);
  const gridR=Math.max(120,Math.min(W,H)/2-pad);
  const baseR=gridR;
  const uiScale=clamp(baseR/420,.55,1.12);
  const rs=rangeSettings();
  const scale=gridR/rs.radar;

  ctx.clearRect(0,0,c.width,c.height);
  ctx.save();
  ctx.scale(dpr,dpr);
  ctx.fillStyle='#020907';
  ctx.fillRect(0,0,W,H);

  // Full-panel atmospheric glow.
  const bg=ctx.createRadialGradient(cx,cy,0,cx,cy,effectR);
  bg.addColorStop(0,'#061510');
  bg.addColorStop(.58,'#03100b');
  bg.addColorStop(1,'#020907');
  ctx.fillStyle=bg;
  ctx.fillRect(0,0,W,H);

  // Circular radar grid. Circles remain round and fully visible inside the panel.
  ctx.strokeStyle='rgba(0,100,60,.17)';
  ctx.lineWidth=.7;
  [.25,.5,.75,1].forEach(k=>{
    ctx.beginPath();
    ctx.arc(cx,cy,gridR*k,0,Math.PI*2);
    ctx.stroke();
  });
  ctx.beginPath();
  ctx.moveTo(cx,0);ctx.lineTo(cx,H);
  ctx.moveTo(0,cy);ctx.lineTo(W,cy);
  ctx.stroke();

  // Selected mic/hearing rings: always perfect circles.
  rs.mics
    .slice()
    .sort((a,b)=>b.mic-a.mic)
    .forEach((m,idx)=>{
      const rr=m.mic*scale;
      ctx.setLineDash([8,6]);
      ctx.strokeStyle=m.color;
      ctx.lineWidth=2.2;
      ctx.beginPath();
      ctx.arc(cx,cy,rr,0,Math.PI*2);
      ctx.stroke();
      ctx.setLineDash([]);
      if(!rs.usingHuman && !m.human){
        const label=`${m.short}`;
        const angle=(-90+idx*18)*D2R;
        let lx=cx+Math.cos(angle)*rr;
        let ly=cy+Math.sin(angle)*rr;
        ctx.font=`800 ${Math.round(Math.max(21,22*uiScale))}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`;
        ctx.textAlign='center';
        const tw=ctx.measureText(label).width+(10*uiScale);
        const bh=24*uiScale;
        lx=clamp(lx,tw/2+4,W-tw/2-4);
        ly=clamp(ly,bh*.75+4,H-bh*.25-4);
        ctx.fillStyle='rgba(0,12,8,.78)';
        ctx.fillRect(lx-tw/2,ly-bh*.55,tw,bh);
        ctx.fillStyle=m.color;
        ctx.fillText(label,lx,ly+6*uiScale);
      }
    });

  // Sweep fan reaches the farthest rectangle corner while rings stay fully visible.
  const sr=(state.sweep-90)*D2R;
  for(let i=0;i<30;i++){
    const t=i/30;
    const a0=sr-(1-t+1/30)*1.1;
    const a1=sr-(1-t)*1.1;
    ctx.beginPath();
    ctx.moveTo(cx,cy);
    ctx.arc(cx,cy,effectR,a0,a1);
    ctx.closePath();
    ctx.fillStyle=`rgba(0,255,110,${(1-t)*.055})`;
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(cx,cy);
  ctx.lineTo(cx+effectR*Math.cos(sr),cy+effectR*Math.sin(sr));
  ctx.strokeStyle='rgba(0,255,100,.92)';
  ctx.lineWidth=1.5;
  ctx.stroke();

  // Cardinal labels sit against the rectangular panel edges.
  ctx.fillStyle='rgba(80,150,95,.6)';
  ctx.font=`800 ${Math.round(Math.max(14,14*uiScale))}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`;
  ctx.textAlign='center';
  ctx.fillText('N',cx,pad);
  ctx.fillText('S',cx,H-pad+4*uiScale);
  ctx.fillText('E',W-pad,cy+4*uiScale);
  ctx.fillText('W',pad,cy+4*uiScale);

  state.analyzed.forEach(p=>{
    if(p.status==='high'&&p.h>rs.radar)return;
    const px=cx+p.x*scale;
    const py=cy-p.y*scale;
    const margin=80*uiScale;
    if(px < -margin || px > W + margin || py < -margin || py > H + margin)return;

    const col=p.status==='audible'?'#ff5050':p.status==='approaching'?'#ffd040':p.status==='clear'?'#00ff8a':'#607070';

    if(p.entry!=null&&p.exit!=null){
      ctx.beginPath();
      ctx.moveTo(px,py);
      ctx.lineTo(cx+(p.x+p.vx*120)*scale,cy-(p.y+p.vy*120)*scale);
      ctx.strokeStyle=p.status==='audible'?'rgba(255,80,80,.35)':'rgba(255,210,60,.3)';
      ctx.setLineDash([4,6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const size=clamp((9+p.risk*8)*uiScale,5,22*uiScale);
    ctx.save();
    ctx.translate(px,py);
    ctx.rotate(p.track*D2R);
    ctx.beginPath();
    ctx.moveTo(0,-size);
    ctx.lineTo(size*.58,size*.78);
    ctx.lineTo(0,size*.35);
    ctx.lineTo(-size*.58,size*.78);
    ctx.closePath();
    ctx.fillStyle=col;
    ctx.shadowColor=col;
    ctx.shadowBlur=p.status==='audible'?12:6;
    ctx.globalAlpha=p.status==='high'?0.55:1;
    ctx.fill();
    ctx.restore();

    let tag='';
    if(p.status==='audible'&&p.exit!=null)tag='-'+fmt(p.exit);
    else if(p.entry!=null)tag='+'+fmt(p.entry);

    if(tag){
      const tagFont=Math.round(Math.max(20,22*uiScale));
      const tagPad=7*uiScale;
      const tagH=Math.max(30,30*uiScale);
      ctx.font=`800 ${tagFont}px -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'SF Pro Display', 'Helvetica Neue', Arial, sans-serif`;
      ctx.textAlign='left';
      const w=ctx.measureText(tag).width+tagPad*2;
      let x=px+size*.7;
      let y=py-size-(16*uiScale);
      x=clamp(x,4,W-w-4);
      y=clamp(y,4,H-tagH-4);
      ctx.fillStyle='rgba(0,0,0,.78)';
      ctx.fillRect(x,y,w,tagH);
      ctx.strokeStyle=col;
      ctx.strokeRect(x,y,w,tagH);
      ctx.fillStyle=col;
      ctx.fillText(tag,x+tagPad,y+tagH*.72);
    }
  });

  ctx.beginPath();ctx.arc(cx,cy,5,0,Math.PI*2);ctx.fillStyle='#d4a017';ctx.fill();
  ctx.beginPath();ctx.arc(cx,cy,11,0,Math.PI*2);ctx.strokeStyle='rgba(212,160,23,.35)';ctx.stroke();

  ctx.restore();
}
