'use strict';

function startLoop(){
  if(state.timer)clearInterval(state.timer);
  fetchFeed();
  state.timer=setInterval(fetchFeed,REFRESH_MS);
}

function anim(ts){
  if(!state.rafLast)state.rafLast=ts;
  const dt=Math.min((ts-state.rafLast)/1000,.1);
  state.rafLast=ts;
  state.prevSweep=state.sweep;
  state.sweep=(state.sweep+SWEEP_SPEED*dt)%360;
  if(Math.floor(ts/1000)!==Math.floor((ts-dt*1000)/1000)){
    recompute();
    renderMeta();
    renderBanner();
    if(state.activePanel==='aircraft')renderAircraftList();
  }
  drawRadar();
  requestAnimationFrame(anim);
}
