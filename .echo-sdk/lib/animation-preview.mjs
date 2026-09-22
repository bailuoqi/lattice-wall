const easingByName = {
  linear: 'linear',
  ease: 'ease',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'echo-spring': 'cubic-bezier(0.22, 1, 0.36, 1)',
  'echo-snappy': 'cubic-bezier(0.2, 0.9, 0.2, 1)',
  'echo-gentle': 'cubic-bezier(0.33, 1, 0.68, 1)',
  'echo-elastic': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
};

export const animationLibraryMinEchoVersion = '26.9.1';

const originByName = {
  center: '50% 50%', top: '50% 0%', right: '100% 50%', bottom: '50% 100%', left: '0% 50%',
  'top-left': '0% 0%', 'top-right': '100% 0%', 'bottom-right': '100% 100%', 'bottom-left': '0% 100%',
};

const clipDirections = new Set([
  'left-to-right', 'right-to-left', 'top-to-bottom', 'bottom-to-top', 'center-out-x', 'center-out-y',
]);
const staggerOrigins = new Set(['first', 'center', 'last', 'edges']);

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const animationKeys = new Set([
  'id', 'title', 'description', 'trigger', 'durationMs', 'delayMs', 'easing',
  'loop', 'direction', 'origin', 'clipDirection', 'stagger', 'keyframes',
]);
const keyframeRanges = {
  offset: [0, 1], opacity: [0, 1], translateX: [-512, 512], translateY: [-512, 512],
  translateZ: [-256, 256], scale: [0.1, 4], rotateXDeg: [-180, 180],
  rotateYDeg: [-180, 180], rotateDeg: [-360, 360], skewXDeg: [-45, 45], skewYDeg: [-45, 45],
  clipProgress: [0, 1],
};
const triggers = new Set(['scene-enter', 'track-change', 'line-change', 'ambient']);
const directions = new Set(['normal', 'reverse', 'alternate', 'alternate-reverse']);

export const isAnimationPreviewDefinitionValid = (definition) => {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) return false;
  if (Object.keys(definition).some((key) => !animationKeys.has(key))) return false;
  if (typeof definition.id !== 'string' || !/^[a-z0-9](?:[a-z0-9._-]{0,46}[a-z0-9])?$/u.test(definition.id)) return false;
  if (typeof definition.title !== 'string' || definition.title.length < 1 || definition.title.length > 120) return false;
  if (definition.description !== undefined && (typeof definition.description !== 'string' || definition.description.length > 300)) return false;
  if (definition.trigger !== undefined && !triggers.has(definition.trigger)) return false;
  if (definition.easing !== undefined && !Object.hasOwn(easingByName, definition.easing)) return false;
  if (definition.direction !== undefined && !directions.has(definition.direction)) return false;
  if (definition.origin !== undefined && !Object.hasOwn(originByName, definition.origin)) return false;
  if (definition.clipDirection !== undefined && !clipDirections.has(definition.clipDirection)) return false;
  if (definition.durationMs !== undefined && (!Number.isInteger(definition.durationMs) || definition.durationMs < 80 || definition.durationMs > 30_000)) return false;
  if (definition.delayMs !== undefined && (!Number.isInteger(definition.delayMs) || definition.delayMs < 0 || definition.delayMs > 30_000)) return false;
  if (definition.loop !== undefined && typeof definition.loop !== 'boolean') return false;
  if (definition.trigger === 'ambient' && definition.loop === false) return false;
  if (definition.stagger !== undefined) {
    const stagger = definition.stagger;
    if (!stagger || typeof stagger !== 'object' || Array.isArray(stagger)) return false;
    if (Object.keys(stagger).some((key) => !['stepMs', 'maxDelayMs', 'from'].includes(key))) return false;
    if (!Number.isInteger(stagger.stepMs) || stagger.stepMs < 0 || stagger.stepMs > 800) return false;
    if (stagger.maxDelayMs !== undefined && (!Number.isInteger(stagger.maxDelayMs) || stagger.maxDelayMs < 0 || stagger.maxDelayMs > 5_000)) return false;
    if (stagger.from !== undefined && !staggerOrigins.has(stagger.from)) return false;
  }
  const frames = definition.keyframes;
  if (!Array.isArray(frames) || frames.length < 2 || frames.length > 8) return false;
  if (frames[0]?.offset !== 0 || frames.at(-1)?.offset !== 1) return false;
  const framesValid = frames.every((frame, index) => {
    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) return false;
    const keys = Object.keys(frame);
    if (keys.length < 2 || keys.some((key) => !Object.hasOwn(keyframeRanges, key))) return false;
    if (index > 0 && frame.offset <= frames[index - 1].offset) return false;
    return keys.every((key) => {
      const value = frame[key];
      const [minimum, maximum] = keyframeRanges[key];
      return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;
    });
  });
  if (!framesValid) return false;
  const hasClipProgress = frames.some((frame) => frame.clipProgress !== undefined);
  return hasClipProgress === (definition.clipDirection !== undefined);
};

const compileClipPath = (direction, progressInput) => {
  const hidden = (1 - clamp(progressInput, 0, 1)) * 100;
  if (direction === 'left-to-right') return `inset(0 ${hidden}% 0 0)`;
  if (direction === 'right-to-left') return `inset(0 0 0 ${hidden}%)`;
  if (direction === 'top-to-bottom') return `inset(0 0 ${hidden}% 0)`;
  if (direction === 'bottom-to-top') return `inset(${hidden}% 0 0 0)`;
  if (direction === 'center-out-x') return `inset(0 ${hidden / 2}% 0 ${hidden / 2}%)`;
  return `inset(${hidden / 2}% 0 ${hidden / 2}% 0)`;
};

export const resolveAnimationPreviewStaggerOrder = (indexInput, countInput, from = 'first') => {
  const count = Math.max(1, Math.floor(countInput));
  const index = clamp(Math.floor(indexInput), 0, count - 1);
  if (from === 'last') return count - 1 - index;
  if (from === 'center') return Math.abs(index - (count - 1) / 2) - (count % 2 === 0 ? 0.5 : 0);
  if (from === 'edges') return Math.min(index, count - 1 - index);
  return index;
};

export const compileAnimationPreviewKeyframes = (definition, intensityInput = 1) => {
  const intensity = clamp(Number(intensityInput) || 0, 0, 2);
  const frames = Array.isArray(definition?.keyframes) ? definition.keyframes : [];
  const hasTransform = frames.some((frame) => [
    frame.translateX, frame.translateY, frame.translateZ, frame.scale,
    frame.rotateXDeg, frame.rotateYDeg, frame.rotateDeg, frame.skewXDeg, frame.skewYDeg,
  ].some((value) => value !== undefined));
  const hasDepth = frames.some((frame) =>
    frame.translateZ !== undefined || frame.rotateXDeg !== undefined || frame.rotateYDeg !== undefined);
  const hasClip = definition?.clipDirection !== undefined && frames.some((frame) => frame.clipProgress !== undefined);
  return frames.map((frame) => ({
    offset: frame.offset,
    ...(frame.opacity !== undefined ? { opacity: clamp(1 + (frame.opacity - 1) * intensity, 0, 1) } : {}),
    ...(hasTransform ? {
      transformOrigin: originByName[definition.origin] ?? originByName.center,
      transform: [
        ...(hasDepth ? ['perspective(900px)'] : []),
        `translate3d(${(frame.translateX ?? 0) * intensity}px, ${(frame.translateY ?? 0) * intensity}px, ${(frame.translateZ ?? 0) * intensity}px)`,
        `rotateX(${(frame.rotateXDeg ?? 0) * intensity}deg)`,
        `rotateY(${(frame.rotateYDeg ?? 0) * intensity}deg)`,
        `rotateZ(${(frame.rotateDeg ?? 0) * intensity}deg)`,
        `skewX(${(frame.skewXDeg ?? 0) * intensity}deg)`,
        `skewY(${(frame.skewYDeg ?? 0) * intensity}deg)`,
        `scale(${1 + ((frame.scale ?? 1) - 1) * intensity})`,
      ].join(' '),
    } : {}),
    ...(hasClip ? {
      clipPath: compileClipPath(
        definition.clipDirection,
        1 + ((frame.clipProgress ?? 1) - 1) * intensity,
      ),
    } : {}),
  }));
};

export const compileAnimationPreviewTiming = (definition, sequence) => ({
  duration: definition.durationMs ?? 600,
  delay: (definition.delayMs ?? 0) + (definition.stagger && sequence
    ? Math.min(
        resolveAnimationPreviewStaggerOrder(sequence.index, sequence.count, definition.stagger.from) * definition.stagger.stepMs,
        definition.stagger.maxDelayMs ?? 2_400,
      )
    : 0),
  easing: easingByName[definition.easing] ?? easingByName['ease-out'],
  iterations: definition.loop === true ? Infinity : 1,
  direction: definition.direction ?? 'normal',
  fill: 'both',
});

const jsonForInlineScript = (value) => JSON.stringify(value)
  .replaceAll('<', '\\u003c')
  .replaceAll('>', '\\u003e')
  .replaceAll('&', '\\u0026');

export const animationPreviewHtml = (entry) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ECHO Motion Score</title>
  <style>
    :root{color-scheme:dark;--ink:#10151d;--panel:#171e29;--bone:#ebe6da;--muted:#8d98a8;--line:#2a3442;--blue:#5375ff;--coral:#ff705f;--brass:#d8b66a}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;background:var(--ink);color:var(--bone);font-family:"Segoe UI Variable",Segoe UI,sans-serif}
    button,select,input{font:inherit}button,select{color:inherit}.shell{width:min(1440px,100%);margin:auto;padding:24px clamp(18px,4vw,64px) 64px}
    .mast{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;padding:36px 0 26px;border-bottom:1px solid var(--line)}
    .eyebrow,.utility,.trigger{font-family:"Cascadia Mono",Consolas,monospace;text-transform:uppercase;letter-spacing:.12em}
    .eyebrow{margin:0 0 12px;color:var(--brass);font-size:11px}.title{margin:0;max-width:850px;font-family:"Bahnschrift SemiCondensed","Arial Narrow",sans-serif;font-size:clamp(46px,8vw,108px);font-weight:600;line-height:.82;letter-spacing:-.055em}
    .deck{max-width:620px;margin:20px 0 0;color:var(--muted);font-size:15px;line-height:1.65}.summary{display:grid;grid-template-columns:repeat(2,90px);gap:10px}
    .metric{padding:14px;border:1px solid var(--line);background:#131a23}.metric strong{display:block;font-family:"Bahnschrift SemiCondensed",sans-serif;font-size:30px;font-weight:500}.metric span{color:var(--muted);font:10px "Cascadia Mono",monospace;text-transform:uppercase;letter-spacing:.1em}
    .score{position:relative;height:25px;margin:18px 0 0;background:repeating-linear-gradient(90deg,var(--line) 0 1px,transparent 1px 7.142%)}.score::after{content:"";position:absolute;left:0;right:0;top:12px;border-top:1px solid var(--line)}
    .playhead{position:absolute;z-index:1;inset:8px 0 auto;height:9px;background:var(--coral);transform:scaleX(0);transform-origin:left center}
    .toolbar{position:sticky;z-index:4;top:0;display:flex;flex-wrap:wrap;gap:10px;align-items:center;padding:14px 0;background:color-mix(in srgb,var(--ink) 92%,transparent);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
    .toolbar label{display:flex;align-items:center;gap:9px;color:var(--muted);font:11px "Cascadia Mono",monospace;text-transform:uppercase;letter-spacing:.08em}.toolbar select,.replay{min-height:38px;padding:0 13px;border:1px solid var(--line);border-radius:0;background:var(--panel)}
    .toolbar input{accent-color:var(--coral)}.replay{margin-left:auto;cursor:pointer;background:var(--bone);color:var(--ink);font-weight:650}.replay:hover{background:var(--coral)}
    .status{width:100%;margin:0;color:var(--muted);font-size:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,310px),1fr));border-left:1px solid var(--line)}
    .card{position:relative;min-height:330px;padding:0;border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);background:transparent;color:inherit;text-align:left;cursor:pointer;overflow:hidden}.card[data-choreography="true"]::after{content:"ENSEMBLE";position:absolute;right:11px;top:11px;z-index:2;padding:5px 7px;background:var(--coral);color:var(--ink);font:700 9px "Cascadia Mono",monospace;letter-spacing:.1em}
    .card[hidden]{display:none}.card:focus-visible{outline:2px solid var(--coral);outline-offset:-3px}.stage{position:relative;height:210px;display:grid;place-items:center;overflow:hidden;background:repeating-linear-gradient(90deg,transparent 0 calc(25% - 1px),#1e2733 calc(25% - 1px) 25%)}
    .stage::before,.stage::after{content:"";position:absolute;background:var(--line)}.stage::before{width:1px;height:100%;left:50%}.stage::after{height:1px;width:100%;top:50%}
    .voice{position:relative;z-index:1}.glyph{width:152px;padding:17px 18px 15px;background:var(--bone);color:var(--ink);box-shadow:9px 9px 0 color-mix(in srgb,var(--blue) 72%,transparent)}
    .stage[data-ensemble="true"] .voice{position:absolute}.stage[data-ensemble="true"] .voice:nth-child(1){transform:translate(-34px,-30px)}.stage[data-ensemble="true"] .voice:nth-child(2){transform:translate(0,0)}.stage[data-ensemble="true"] .voice:nth-child(3){transform:translate(34px,30px)}.stage[data-ensemble="true"] .glyph{width:118px;padding:12px 14px 11px;box-shadow:6px 6px 0 color-mix(in srgb,var(--blue) 72%,transparent)}
    .glyph strong{display:block;font-family:"Bahnschrift SemiCondensed",sans-serif;font-size:25px;line-height:1;letter-spacing:-.04em}.glyph i{display:block;height:3px;margin-top:8px;background:var(--ink)}.glyph i:last-child{width:62%;background:var(--coral)}
    .copy{padding:18px}.copy h2{margin:0;font-family:"Bahnschrift SemiCondensed",sans-serif;font-size:22px;font-weight:550}.copy p{min-height:38px;margin:7px 0 12px;color:var(--muted);font-size:12px;line-height:1.5}
    .meta{display:flex;justify-content:space-between;gap:10px;padding-top:11px;border-top:1px solid var(--line)}.trigger{color:var(--brass);font-size:9px}.utility{color:var(--muted);font-size:9px;text-transform:none;letter-spacing:.03em}
    @media(max-width:720px){.mast{grid-template-columns:1fr}.summary{grid-template-columns:repeat(2,1fr)}.toolbar{position:relative}.replay{margin-left:0}.card{min-height:310px}}
    @media(prefers-reduced-motion:reduce){.playhead{display:none}.card{scroll-behavior:auto}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="mast">
      <div><p class="eyebrow">ECHO Workshop / kinetic score 01</p><h1 class="title" id="title">Motion Foundation</h1><p class="deck" id="description"></p></div>
      <div class="summary"><div class="metric"><strong id="count">0</strong><span>exports</span></div><div class="metric"><strong>0</strong><span>scripts</span></div></div>
    </header>
    <div class="score" aria-hidden="true"><div class="playhead" id="playhead"></div></div>
    <section class="toolbar" aria-label="Animation preview controls">
      <label>Trigger <select id="trigger"><option value="all">All exports</option></select></label>
      <label>Intensity <input id="intensity" type="range" min="0" max="2" step="0.1" value="1"><output id="intensity-value">1.0</output></label>
      <button class="replay" id="replay" type="button">Replay visible</button>
      <p class="status" id="status">Select any score card to replay that export.</p>
    </section>
    <section class="grid" id="grid" aria-live="polite"></section>
  </main>
  <script type="module">
    const entry=${jsonForInlineScript(entry)};
    const easings=${jsonForInlineScript(easingByName)};
    const origins=${jsonForInlineScript(originByName)};
    const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
    const clipPath=(direction,progressInput)=>{const hidden=(1-clamp(progressInput,0,1))*100;if(direction==='left-to-right')return 'inset(0 '+hidden+'% 0 0)';if(direction==='right-to-left')return 'inset(0 0 0 '+hidden+'%)';if(direction==='top-to-bottom')return 'inset(0 0 '+hidden+'% 0)';if(direction==='bottom-to-top')return 'inset('+hidden+'% 0 0 0)';if(direction==='center-out-x')return 'inset(0 '+hidden/2+'% 0 '+hidden/2+'%)';return 'inset('+hidden/2+'% 0 '+hidden/2+'% 0)'};
    const staggerOrder=(index,count,from='first')=>{if(from==='last')return count-1-index;if(from==='center')return Math.abs(index-(count-1)/2)-(count%2===0?.5:0);if(from==='edges')return Math.min(index,count-1-index);return index};
    const reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const running=new WeakMap();
    const animations=Array.isArray(entry.animations)?entry.animations:[];
    const byId=(id)=>document.getElementById(id);
    const buildFrames=(definition,intensityInput)=>{
      const intensity=clamp(Number(intensityInput)||0,0,2);const frames=Array.isArray(definition.keyframes)?definition.keyframes:[];
      const hasTransform=frames.some((frame)=>[frame.translateX,frame.translateY,frame.translateZ,frame.scale,frame.rotateXDeg,frame.rotateYDeg,frame.rotateDeg,frame.skewXDeg,frame.skewYDeg].some((value)=>value!==undefined));
      const hasDepth=frames.some((frame)=>frame.translateZ!==undefined||frame.rotateXDeg!==undefined||frame.rotateYDeg!==undefined);
      const hasClip=definition.clipDirection!==undefined&&frames.some((frame)=>frame.clipProgress!==undefined);
      return frames.map((frame)=>({offset:frame.offset,...(frame.opacity!==undefined?{opacity:clamp(1+(frame.opacity-1)*intensity,0,1)}:{}),...(hasTransform?{transformOrigin:origins[definition.origin]??origins.center,transform:[...(hasDepth?['perspective(900px)']:[]),'translate3d('+((frame.translateX??0)*intensity)+'px, '+((frame.translateY??0)*intensity)+'px, '+((frame.translateZ??0)*intensity)+'px)','rotateX('+((frame.rotateXDeg??0)*intensity)+'deg)','rotateY('+((frame.rotateYDeg??0)*intensity)+'deg)','rotateZ('+((frame.rotateDeg??0)*intensity)+'deg)','skewX('+((frame.skewXDeg??0)*intensity)+'deg)','skewY('+((frame.skewYDeg??0)*intensity)+'deg)','scale('+(1+((frame.scale??1)-1)*intensity)+')'].join(' ')}:{}),...(hasClip?{clipPath:clipPath(definition.clipDirection,1+((frame.clipProgress??1)-1)*intensity)}:{})}));
    };
    const replay=(target,definition,sequence)=>{running.get(target)?.cancel();if(reduced.matches)return;const staggerDelay=definition.stagger&&sequence?Math.min(staggerOrder(sequence.index,sequence.count,definition.stagger.from)*definition.stagger.stepMs,definition.stagger.maxDelayMs??2400):0;const player=target.animate(buildFrames(definition,byId('intensity').value),{duration:definition.durationMs??600,delay:(definition.delayMs??0)+staggerDelay,easing:easings[definition.easing]??easings['ease-out'],iterations:definition.loop===true?Infinity:1,direction:definition.direction??'normal',fill:'both'});running.set(target,player)};
    const replayCard=(card)=>{const definition=animations[Number(card.dataset.index)];const glyphs=[...card.querySelectorAll('.glyph')];glyphs.forEach((glyph,index)=>replay(glyph,definition,{index,count:glyphs.length}))};
    const replayVisible=()=>{document.querySelectorAll('.card:not([hidden])').forEach(replayCard);if(!reduced.matches)byId('playhead').animate([{transform:'scaleX(0)'},{transform:'scaleX(1)'}],{duration:1200,easing:easings['echo-snappy'],fill:'both'})};
    byId('title').textContent=entry.title||'Motion Foundation';byId('description').textContent=entry.description||'Host-interpreted motion exports.';byId('count').textContent=String(animations.length);
    const triggers=[...new Set(animations.map((item)=>item.trigger??'scene-enter'))];for(const trigger of triggers){const option=document.createElement('option');option.value=trigger;option.textContent=trigger;byId('trigger').append(option)}
    animations.forEach((definition,index)=>{const card=document.createElement('button');card.type='button';card.className='card';card.dataset.index=String(index);card.dataset.trigger=definition.trigger??'scene-enter';card.dataset.choreography=String(Boolean(definition.stagger));card.setAttribute('aria-label','Replay '+definition.title);const stage=document.createElement('div');stage.className='stage';const voiceCount=definition.stagger?3:1;stage.dataset.ensemble=String(voiceCount>1);for(let voiceIndex=0;voiceIndex<voiceCount;voiceIndex+=1){const voice=document.createElement('div');voice.className='voice';const glyph=document.createElement('div');glyph.className='glyph';const word=document.createElement('strong');word.textContent=definition.stagger?'SCORE':'MOVE';glyph.append(word,document.createElement('i'),document.createElement('i'));voice.append(glyph);stage.append(voice)}const copy=document.createElement('div');copy.className='copy';const body=document.createElement('div');const heading=document.createElement('h2');heading.textContent=definition.title;const detail=document.createElement('p');detail.textContent=definition.description||definition.id;const meta=document.createElement('div');meta.className='meta';const trigger=document.createElement('span');trigger.className='trigger';trigger.textContent=definition.trigger??'scene-enter';const utility=document.createElement('span');utility.className='utility';utility.textContent=definition.stagger?definition.stagger.from+' · '+definition.stagger.stepMs+' ms step':definition.id+' · '+(definition.durationMs??600)+' ms';meta.append(trigger,utility);body.append(heading,detail,meta);copy.append(body);card.append(stage,copy);card.addEventListener('click',()=>replayCard(card));byId('grid').append(card)});
    byId('trigger').addEventListener('change',(event)=>{const selected=event.target.value;document.querySelectorAll('.card').forEach((card)=>{card.hidden=selected!=='all'&&card.dataset.trigger!==selected});replayVisible()});
    byId('intensity').addEventListener('input',(event)=>{byId('intensity-value').textContent=Number(event.target.value).toFixed(1);replayVisible()});byId('replay').addEventListener('click',replayVisible);
    const updateReduced=()=>{byId('status').textContent=reduced.matches?'Reduced motion is active; previews are paused.':'Select any score card to replay that export.';if(reduced.matches)document.querySelectorAll('.glyph').forEach((target)=>running.get(target)?.cancel());else replayVisible()};reduced.addEventListener?.('change',updateReduced);updateReduced();
  </script>
</body>
</html>`;
