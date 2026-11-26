// Native IPC supplies only validated local files and game artwork. Keep one active
// decode/download while the player scrolls. The latest selection always wins.
export async function decodeBackground(url) {
  if (!url) return null;
  const image = new Image();
  image.src = url;
  try { await image.decode(); } catch { return null; }
  return image.naturalWidth >= 1920 && image.naturalHeight >= 1080 &&
    image.naturalWidth > image.naturalHeight ? image : null;
}

export function homeBackground(layer, invoke) {
  let selection, shown, timer, running = false, queued;
  function fit() {
    if (!shown) return;
    const width = shown.naturalWidth / devicePixelRatio;
    const height = shown.naturalHeight / devicePixelRatio;
    layer.style.backgroundSize = width >= layer.clientWidth && height >= layer.clientHeight
      ? 'cover' : width + 'px ' + height + 'px';
  }
  new ResizeObserver(fit).observe(layer);
  function watchScale() {
    fit();
    matchMedia('(resolution: ' + devicePixelRatio + 'dppx)').addEventListener('change', watchScale, {once:true});
  }
  watchScale();
  function show(image) {
    shown = image;
    layer.style.backgroundImage = image ? 'url(' + image.src + ')' : 'none';
    fit();
    layer.style.opacity = image ? '1' : '0';
  }
  async function drain() {
    if (running) return;
    running = true;
    try {
      while (queued) {
        const job = queued;
        queued = null;
        const local = await decodeBackground(await invoke('artwork', {id:job.id,hero:true}).catch(()=>null));
        if (selection !== job) continue;
        if (local) show(local);
        if (!job.source || (!job.override && local?.naturalWidth >= 3840 && local.naturalHeight >= 2160)) continue;
        const remote = await decodeBackground(await invoke('online_background', {source:job.source,online:job.online}).catch(()=>null));
        if (selection !== job || !remote) continue;
        const coverage = image => Math.min(image.naturalWidth / layer.clientWidth, image.naturalHeight / layer.clientHeight);
        if (job.override || !local || coverage(remote) > coverage(local)) show(remote);
      }
    } finally { running = false; }
  }
  return (id, source, online, override, refresh=false) => {
    if (!refresh && selection?.id===id && selection.source===source && selection.online===online && selection.override===override) return;
    const sameGame = id && selection?.id===id && selection.source===source && selection.online===online;
    selection = {id,source,online,override};
    queued = null;
    clearTimeout(timer);
    if (!sameGame) show(null);
    if (id) timer = setTimeout(()=>{queued=selection;drain()},140);
  };
}
