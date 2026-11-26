// Native IPC supplies only validated local files and game artwork. A slow remote request must never
// block the next game's local image. Only the current selection is painted.
export async function decodeBackground(url, steamHero=false) {
  if (!url) return null;
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { return null; }
  return image.naturalWidth >= 1920 && (image.naturalHeight >= 1080 || (steamHero && image.naturalHeight >= 620 && image.naturalWidth >= 2*image.naturalHeight)) &&
    image.naturalWidth > image.naturalHeight ? image : null;
}

export function homeBackground(layer, invoke) {
  let selection, shown, timer, running = false, queued;
  function fit() {
    if (!shown) return;
    const width = shown.naturalWidth / devicePixelRatio;
    const height = shown.naturalHeight / devicePixelRatio;
    const fills=width>=layer.clientWidth && height>=layer.clientHeight;
    layer.style.backgroundSize=fills?'cover':width+'px '+height+'px';
    layer.style.maskImage=fills?'none':'radial-gradient(ellipse closest-side,black 62%,transparent 100%)';
    layer.style.maskSize=layer.style.backgroundSize;
  }
  new ResizeObserver(fit).observe(layer);
  function watchScale() {
    fit();
    matchMedia('(resolution: ' + devicePixelRatio + 'dppx)').addEventListener('change', watchScale, {once:true});
  }
  watchScale();
  function show(image) {
    shown = image;
    if(image)layer.parentElement.style.setProperty('--scene','url('+image.src+')');
    else layer.parentElement.style.removeProperty('--scene');
    layer.style.backgroundImage = image ? 'url(' + image.src + ')' : 'none';
    fit();
    layer.style.opacity = image ? '1' : '0';
  }
  async function drainRemote() {
    if (running) return;
    running=true;
    try {
      while (queued) {
        const {job,local}=queued;
        queued=null;
        const url=await invoke('online_background',{source:job.source,online:job.online}).catch(()=>null);
        if(selection!==job)continue;
        const remote=await decodeBackground(url,job.source.startsWith('steam:'));
        if(selection!==job || !remote)continue;
        const coverage=image=>Math.min(image.naturalWidth/layer.clientWidth,image.naturalHeight/layer.clientHeight);
        if(job.override||!local||coverage(remote)>coverage(local))show(remote);
      }
    } finally {running=false}
  }
  async function load(job) {
    const url=await invoke('artwork',{id:job.id,hero:true}).catch(()=>null);
    if(selection!==job)return;
    const local=await decodeBackground(url,job.id.startsWith('steam:'));
    if(selection!==job)return;
    if(local)show(local);
    if(job.source && (job.override || !(local?.naturalWidth>=3840 && local.naturalHeight>=2160))){
      queued={job,local};drainRemote();
    }
  }
  return (id, source, online, override, refresh=false) => {
    if (!refresh && selection?.id===id && selection.source===source && selection.online===online && selection.override===override) return;
    const sameGame = id && selection?.id===id && selection.source===source && selection.online===online;
    selection = {id,source,online,override};
    queued = null;
    clearTimeout(timer);
    if (!sameGame) show(null);
    if (id) timer = setTimeout(load,140,selection);
  };
}
