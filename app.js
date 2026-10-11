/* =========================================================================
   De fuera hacia adentro · lógica de la presentación
   - Modelo interactivo a la izquierda (model-viewer para anatomía, 3Dmol.js para moléculas)
   - Video a la derecha: fragmentos locales, automáticos, sin audio y en bucle (como GIF)
   - Ideas clave que avanzan con flecha derecha / Espacio / clicker
   - Referencias APA 7 al pie de cada diapositiva
   Todo es local: funciona abriendo index.html con doble clic y sin internet.
   ========================================================================= */
(function(){
'use strict';
const C = window.CONTENIDO, S = C.diapositivas, REF = C.referencias, E = window.ESTRUCTURAS || {};
const $ = id => document.getElementById(id);
const PRESENTER = location.hash === '#presentador';
const MOVIL = window.matchMedia('(orientation: portrait), (max-width: 760px)');  // celular o pantalla vertical
const chan = ('BroadcastChannel' in window) ? new BroadcastChannel('bioinfo-expo') : null;

let cur = 0, msgI = 0, clipI = 0;
let t0 = null, clockTimer = null;

/* ---------------- utilidades ---------------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const linkify = html => html.replace(/(https?:\/\/[^\s<]+[^\s<.,;)\]])/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
const fmt = s => { s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ':' + String(s%60).padStart(2,'0'); };
const plain = html => html.replace(/<[^>]+>/g,'');

/* =========================================================================
   NAVEGACIÓN Y RENDER DE DIAPOSITIVAS
   ========================================================================= */
function buildJourney(){
  const j = $('journey'); j.innerHTML = '';
  S.forEach((s, i) => {
    const b = document.createElement('button');
    b.textContent = s.corto;
    b.title = s.titulo + ' · ' + s.escala;
    b.onclick = () => go(i);
    j.appendChild(b);
  });
}
function updateJourney(){
  const bs = $('journey').querySelectorAll('button');
  bs.forEach((b, i) => { b.classList.toggle('on', i === cur); b.classList.toggle('done', i < cur); });
}

function go(i, atEnd){
  i = Math.max(0, Math.min(S.length - 1, i));
  const changed = i !== cur || !go.started;
  cur = i; go.started = true;
  if (cur > 0 && !t0) startClock();
  const s = S[cur];
  if (changed){
    if (MOVIL.matches && go.started2) window.scrollTo({ top: 0, behavior: 'smooth' });
    go.started2 = true;
    $('kicker').textContent = s.kicker;
    $('title').innerHTML = `<span class="anim">${esc(s.titulo)}</span>`;
    $('scale').textContent = s.escala;
    $('slot').textContent = s.tiempo;
    $('qtext').textContent = s.pregunta;
    $('qcard').hidden = true;
    $('tripBar').style.width = (100 * cur / (S.length - 1)) + '%';
    $('slideno').textContent = (cur + 1) + ' / ' + S.length;
    updateJourney();
    loadModel(s);
    clipI = 0; loadClip();
    renderNotes();
  }
  msgI = atEnd ? s.mensajes.length - 1 : 0;
  showMsg(true);
  broadcast();
}
function next(){
  const s = S[cur];
  if (msgI < s.mensajes.length - 1){ msgI++; showMsg(); broadcast(); }
  else if (cur < S.length - 1) go(cur + 1);
}
function prev(){
  if (msgI > 0){ msgI--; showMsg(); broadcast(); }
  else if (cur > 0) go(cur - 1, true);
}

/* ---------------- ideas clave animadas ---------------- */
function showMsg(first){
  const s = S[cur], el = $('msg');
  const put = () => {
    el.classList.remove('out', 'in'); void el.offsetWidth;
    el.innerHTML = s.mensajes[msgI];
    el.classList.add('in');
  };
  if (first){ put(); return; }
  el.classList.remove('in'); el.classList.add('out');
  setTimeout(put, 200);
}

/* ---------------- referencias al pie ---------------- */
function renderRefs(s){
  // Pie de diapositiva: fuente del modelo + fuentes fijas de la diapositiva + fuente del video que se está viendo.
  const vs = s.videos || [], v = vs[clipI];
  const tied = new Set(); vs.forEach(x => { tied.add(x.ref); (x.extra || []).forEach(r => tied.add(r)); });
  const list = [s.modelo.ref, ...(s.modelo.refsExtra || []), ...s.refs.filter(r => !tied.has(r))];
  if (v) list.push(v.ref, ...(v.extra || []));
  $('refs').innerHTML = [...new Set(list)].map(k => REF[k] ? `<li>${linkify(REF[k])}</li>` : '').join('');
  // Si no caben con letra grande, se reduce un poco (sin cortar ninguna referencia).
  const box = $('refsBox'), ol = $('refs');
  box.classList.remove('dense');
  requestAnimationFrame(() => { if (ol.scrollHeight > ol.clientHeight + 1) box.classList.add('dense'); });
}
function renderBiblio(){
  const items = Object.values(REF).slice().sort((a, b) => plain(a).localeCompare(plain(b), 'es', {sensitivity:'base'}));
  $('biblioList').innerHTML = items.map(r => `<li>${linkify(r)}</li>`).join('');
}

/* ---------------- guion ---------------- */
function renderNotes(){
  const s = S[cur];
  $('notesSlide').textContent = s.num + ' · ' + s.titulo + ' · ' + s.tiempo;
  $('notesBody').innerHTML = s.guion;
  $('notesQ').textContent = s.pregunta;
}
function toggle(id){ const d = $(id); d.hidden = !d.hidden; }

/* ---------------- reloj ---------------- */
function startClock(){
  t0 = Date.now();
  clearInterval(clockTimer);
  clockTimer = setInterval(tickClock, 1000); tickClock();
}
function tickClock(){
  if (!t0) { $('clock').textContent = '00:00'; return; }
  const sec = (Date.now() - t0) / 1000;
  $('clock').textContent = String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(Math.floor(sec%60)).padStart(2,'0');
  const m = /(\d+)\s*–\s*(\d+)/.exec(S[cur].tiempo);
  $('clock').classList.toggle('late', !!m && sec/60 > +m[2] + 1);
  if (PRESENTER) renderPresenter();
}

/* =========================================================================
   VIDEO A LA DERECHA (tipo GIF: fragmento local, automático, sin audio y en bucle)
   ========================================================================= */
function loadClip(){
  const s = S[cur], vs = s.videos || [];
  stopYT(); $('videoHost').innerHTML = ''; $('vtime').textContent = '';
  $('vtabs').innerHTML = vs.length > 1 ? vs.map((v, k) => `<button class="${k===clipI?'on':''}" data-k="${k}" title="${esc(v.titulo)}">${k+1}</button>`).join('') : '';
  $('vtabs').querySelectorAll('button').forEach(b => b.onclick = () => { clipI = +b.dataset.k; loadClip(); broadcast(); });
  renderRefs(s);
  if (!vs.length) { $('vcap').textContent = ''; return; }
  const v = vs[clipI];
  let src = REF[v.ref] ? plain(REF[v.ref]).split(' (')[0].replace(/\.$/, '') : '';
  if ((src.match(/,/g) || []).length > 2) src = src.split(',')[0] + ' et al.';  // artículos con muchos autores
  const frag = v.ini != null ? `Fragmento ${fmt(v.ini)}–${fmt(v.fin)} · ` : '';
  const link = v.url ? ` · <a href="${esc(v.url)}" target="_blank" rel="noreferrer">Ver video original</a>` : '';
  $('vcap').innerHTML = esc(v.titulo) + `<small>${frag}${esc(src)}${link}</small>`;
  const yt = EN_LINEA && v.url && /youtube\.com\/watch\?v=([\w-]+)/.exec(v.url);
  if (yt) { playYT(yt[1], v); return; }
  const vid = document.createElement('video');
  vid.src = v.src; vid.muted = true; vid.autoplay = true; vid.loop = true; vid.playsInline = true;
  vid.setAttribute('muted', ''); vid.setAttribute('playsinline', '');
  vid.onerror = () => { $('videoHost').innerHTML = `<div class="vcard"><b>No se encontró el video</b><span>${esc(v.src)}</span></div>`; };
  $('videoHost').appendChild(vid);
  vid.play().catch(() => {});
}

/* En la versión publicada en internet, los fragmentos de YouTube se ven con el reproductor
   oficial de YouTube (no se redistribuyen copias); también en bucle y sin audio. */
const EN_LINEA = /^https?:$/.test(location.protocol) && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
let ytApi = null, ytPlayer = null, ytTimer = null;
function loadYTApi(){
  if (ytApi) return ytApi;
  return ytApi = new Promise((res, rej) => {
    window.onYouTubeIframeAPIReady = () => res(window.YT);
    const sc = document.createElement('script'); sc.src = 'https://www.youtube.com/iframe_api'; sc.onerror = rej;
    document.head.appendChild(sc);
  });
}
function playYT(id, v){
  const s0 = cur, c0 = clipI, div = document.createElement('div');
  $('videoHost').appendChild(div);
  const fallback = () => { $('videoHost').innerHTML = `<div class="vcard"><b>El video no se pudo reproducir aquí</b><a class="btn" href="${esc(v.url)}" target="_blank" rel="noreferrer">Ver el fragmento en YouTube</a></div>`; };
  loadYTApi().then(YT => {
    if (s0 !== cur || c0 !== clipI) return;
    ytPlayer = new YT.Player(div, { videoId: id, width: '100%', height: '100%',
      playerVars: { autoplay: 1, mute: 1, controls: 0, start: v.ini, end: v.fin, rel: 0, playsinline: 1, iv_load_policy: 3, disablekb: 1, fs: 0, origin: location.origin },
      events: { onReady: e => { e.target.mute(); e.target.playVideo(); },
                onStateChange: e => { if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(v.ini, true); e.target.playVideo(); } },
                onError: fallback } });
    ytTimer = setInterval(() => { try { const t = ytPlayer.getCurrentTime(); if (t >= v.fin - 0.3) { ytPlayer.seekTo(v.ini, true); ytPlayer.playVideo(); } } catch(e){} }, 300);
  }).catch(fallback);
}
function stopYT(){ clearInterval(ytTimer); if (ytPlayer) { try { ytPlayer.destroy(); } catch(e){} ytPlayer = null; } }

/* =========================================================================
   MODELOS: anatomía (model-viewer) y moléculas (3Dmol.js)
   ========================================================================= */
let mv = null, mvKey = null, picked = null;
let molDiv = null, viewer = null, molState = {};
const host = () => $('modelHost');

function setEvid(text, cls){ const e = $('evid'); e.textContent = text; e.className = 'evid ' + (cls || ''); }
function setLoading(on, text){ $('loading').classList.toggle('show', !!on); if (text) $('loadingText').textContent = text; }
function clearOverlays(){
  $('pick').className = 'pick'; $('hud').className = 'hud'; $('hud').innerHTML = '';
  $('legend').className = 'legend'; $('legend').innerHTML = ''; $('mcontrols').innerHTML = '';
}
function chip(label, fn, opts = {}){
  const b = document.createElement('button');
  b.className = 'chip' + (opts.on ? ' on' : '') + (opts.cls ? ' ' + opts.cls : '');
  b.innerHTML = label; b.title = opts.title || '';
  b.onclick = e => { e.stopPropagation(); fn(b); b.blur(); placeLegend(); };
  (opts.parent || $('mcontrols')).appendChild(b); return b;
}
function group(){ const g = document.createElement('div'); g.className = 'chipgroup'; $('mcontrols').appendChild(g); return g; }
function radio(buttons, b){ buttons.forEach(x => x.classList.toggle('on', x === b)); }

function loadModel(s){
  const m = s.modelo;
  clearOverlays();
  $('mlabel').textContent = m.etiqueta || '';
  if (m.tipo === 'glb') showGLB(m);
  else if (m.tipo === 'agradecimiento') showThanks(m);
  else showMol(m);
}

/* ---------- cierre: agradecimiento a la escuela ---------- */
function showThanks(m){
  disposeMolHost();
  if (mv && mv.parentNode) mv.parentNode.removeChild(mv);
  setLoading(false); setEvid('', 'oculto');
  host().innerHTML = `<div class="gracias">
    <img src="${esc(m.logo)}" alt="${esc(m.escuela)}">
    <h2>Gracias, ${esc(m.escuela)}</h2>
    <p>${esc(m.texto)}</p>
    <div class="firma">${esc(C.autora)}<span>${esc(C.profesion)}</span></div>
  </div>`;
}

/* ---------- anatomía: modelos BodyParts3D guardados en modelos/*.js ---------- */
// Cada modelo .glb está también como texto base64 en modelos/<nombre>.js; así se carga
// aunque la presentación se abra con doble clic (sin servidor).
const glbURL = {}, glbWait = {};
function needGLB(key){
  if (glbURL[key]) return Promise.resolve(glbURL[key]);
  if (glbWait[key]) return glbWait[key];
  return glbWait[key] = new Promise((res, rej) => {
    const done = () => {
      const b64 = window.MODELOS && window.MODELOS[key];
      if (!b64) { rej(new Error('sin datos')); return; }
      const bin = atob(b64), u = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      delete window.MODELOS[key];
      res(glbURL[key] = URL.createObjectURL(new Blob([u], { type: 'model/gltf-binary' })));
    };
    if (window.MODELOS && window.MODELOS[key]) { done(); return; }
    const sc = document.createElement('script');
    sc.src = 'modelos/' + key + '.js'; sc.onload = done; sc.onerror = () => rej(new Error('no se encontró modelos/' + key + '.js'));
    document.head.appendChild(sc);
  });
}
function preloadGLBs(){
  // Precarga en segundo plano todos los modelos anatómicos para no esperar al cambiar de diapositiva.
  const keys = [...new Set(S.flatMap(s => s.modelo.tipo === 'glb' ? [s.modelo.modelo, s.modelo.extra && s.modelo.extra.modelo] : []).filter(Boolean))];
  keys.reduce((p, k) => p.then(() => needGLB(k)).catch(() => {}), Promise.resolve());
}

function ensureMV(){
  if (mv) return mv;
  mv = document.createElement('model-viewer');
  mv.setAttribute('camera-controls', '');
  // En celular se deja deslizar la página en vertical; girar el modelo es con arrastre horizontal.
  mv.setAttribute('touch-action', MOVIL.matches ? 'pan-y' : 'none');
  mv.setAttribute('interaction-prompt', 'none');
  mv.setAttribute('shadow-intensity', '0.6');
  mv.setAttribute('exposure', '1.05');
  mv.setAttribute('environment-image', 'neutral');
  mv.setAttribute('rotation-per-second', '14deg');
  mv.setAttribute('auto-rotate-delay', '0');
  mv.setAttribute('min-camera-orbit', 'auto auto 2%');
  mv.setAttribute('max-camera-orbit', 'auto auto 300%');
  mv.setAttribute('interpolation-decay', '120');
  mv.addEventListener('load', () => setLoading(false));
  mv.addEventListener('error', () => { setLoading(false); host().innerHTML = '<div class="vcard"><b>No se pudo mostrar el modelo anatómico</b></div>'; mv = null; mvKey = null; });
  mv.addEventListener('pointerdown', e => { mv._down = [e.clientX, e.clientY]; });
  mv.addEventListener('click', e => {
    if (!mv.materialFromPoint) return;
    if (mv._down && Math.hypot(e.clientX - mv._down[0], e.clientY - mv._down[1]) > 6) return;
    const mat = mv.materialFromPoint(e.clientX, e.clientY);
    if (!mat) { unpick(); return; }
    pickMaterial(mat);
  });
  return mv;
}
function unpick(){
  if (picked) { try { picked.mat.pbrMetallicRoughness.setBaseColorFactor(picked.orig); picked.mat.setEmissiveFactor(picked.em); } catch(e){} picked = null; }
  $('pick').className = 'pick';
}
function pickMaterial(mat){
  unpick();
  const pbr = mat.pbrMetallicRoughness;
  picked = { mat, orig: pbr.baseColorFactor.slice(), em: (mat.emissiveFactor || [0,0,0]).slice() };
  pbr.setBaseColorFactor([0.06, 0.70, 0.76, 1]);
  try { mat.setEmissiveFactor([0.02, 0.22, 0.25]); } catch(e){}
  const [nombre, sistema] = (mat.name || 'Estructura').split('|');
  $('pick').innerHTML = `${esc(nombre)}<small>${esc(sistema || '')}${sistema ? ' · ' : ''}clic fuera para quitar</small>`;
  $('pick').className = 'pick show';
}
// Colores de los sistemas (iguales a los del modelo)
const SISTEMAS = [['#e9e2d2', 'óseo'], ['#f2c14e', 'nervioso'], ['#d7333f', 'circulatorio'], ['#7cc4e8', 'respiratorio'], ['#e9935a', 'digestivo'], ['#8e6cc9', 'urinario']];
function showGLB(m, useExtra){
  const spec = useExtra ? Object.assign({}, m, m.extra) : m;
  disposeMolHost();
  const el = ensureMV();
  if (el.parentNode !== host()) { host().innerHTML = ''; host().appendChild(el); }
  unpick();
  setEvid(spec.evidencia || 'Modelo anatómico 3D real · BodyParts3D (DBCLS)');
  $('mlabel').textContent = spec.etiqueta || m.etiqueta;
  $('legend').classList.add('arriba');
  if (spec.leyenda === 'sistemas') legend(SISTEMAS.filter(x => spec.modelo !== 'organos' || !['óseo', 'nervioso'].includes(x[1])).map(([c, t]) => [c, 'Sistema ' + t]));
  else { $('legend').className = 'legend'; }
  const apply = () => {
    el.cameraOrbit = spec.orbita || 'auto auto auto';
    el.cameraTarget = 'auto auto auto';
    el.fieldOfView = 'auto';
    el.resetTurntableRotation && el.resetTurntableRotation(0);
    el.jumpCameraToGoal && el.jumpCameraToGoal();
  };
  if (mvKey !== spec.modelo) {
    mvKey = spec.modelo;
    setLoading(true, 'Cargando modelo 3D…');
    needGLB(spec.modelo).then(url => { if (mvKey === spec.modelo) { el.src = url; apply(); } })
      .catch(err => { setLoading(false); host().innerHTML = `<div class="vcard"><b>Modelo no disponible</b><span>${esc(err.message)}</span></div>`; mv = null; mvKey = null; });
  } else apply();
  if (m.autorrotar && !useExtra) el.setAttribute('auto-rotate', ''); else el.removeAttribute('auto-rotate');
  addGLBControls(m, useExtra);
}
function addGLBControls(m, useExtra){
  $('mcontrols').innerHTML = '';
  if (m.extra) chip(useExtra ? (m.extra.volver || 'Volver') : m.extra.boton, () => showGLB(m, !useExtra), { cls: 'warm' });
  chip('Giro automático', b => { const on = !mv.hasAttribute('auto-rotate'); on ? mv.setAttribute('auto-rotate','') : mv.removeAttribute('auto-rotate'); b.classList.toggle('on', on); }, { on: mv && mv.hasAttribute('auto-rotate') });
  chip('Acercar', () => zoomMV(0.8));
  chip('Alejar', () => zoomMV(1.25));
  chip('Vista inicial', () => { unpick(); showGLB(m, useExtra); });
}
function zoomMV(f){
  try { const o = mv.getCameraOrbit(); mv.cameraOrbit = `${o.theta}rad ${o.phi}rad ${Math.max(0.05, o.radius * f)}m`; } catch(e){}
}

/* ---------- moléculas con 3Dmol.js ---------- */
function disposeMolHost(){
  if (viewer) { try { viewer.clear(); viewer.spin(false); } catch(e){} }
  molState = {};
}
function ensureViewer(){
  if (!molDiv) { molDiv = document.createElement('div'); molDiv.className = 'mol-host'; }
  if (molDiv.parentNode !== host()) { host().innerHTML = ''; host().appendChild(molDiv); }
  if (!viewer) {
    viewer = $3Dmol.createViewer(molDiv, { backgroundColor: 'black', backgroundAlpha: 0, antialias: true });
    viewer.setBackgroundColor(0x000000, 0);
    viewer._vista0 = viewer.getView();  // orientación inicial, para no acumular giros entre visitas
    window.addEventListener('resize', () => { if (viewer) { viewer.resize(); viewer.render(); } });
  }
  viewer.clear(); viewer.removeAllLabels(); viewer.removeAllShapes(); viewer.removeAllSurfaces(); viewer.spin(false);
  viewer.setView(viewer._vista0);
  setTimeout(() => { viewer.resize(); viewer.render(); }, 30);
  return viewer;
}
function showMol(m){
  if (mv && mv.parentNode) mv.parentNode.removeChild(mv);
  unpick();
  if (!window.$3Dmol) { host().innerHTML = '<div class="vcard"><b>El visor molecular no se pudo cargar</b></div>'; return; }
  ensureViewer();
  molState = { m };
  const fn = { dna: molDNA, nucleosoma: molNucleo, amino: molAmino, proteina: molProt, alphafold: molAF, dock: molDock }[m.clase];
  if (fn) fn(m);
  addCommonMolControls();
}
function addCommonMolControls(){
  chip('Girar', b => { const on = !b.classList.contains('on'); viewer.spin(on ? 'y' : false, 0.6); b.classList.toggle('on', on); });
  chip('Vista inicial', () => { viewer.zoomTo(molState.focus || {}); viewer.render(); });
}
const AA = {ALA:'Alanina',ARG:'Arginina',ASN:'Asparagina',ASP:'Ácido aspártico',CYS:'Cisteína',GLN:'Glutamina',GLU:'Ácido glutámico',GLY:'Glicina',HIS:'Histidina',
  ILE:'Isoleucina',LEU:'Leucina',LYS:'Lisina',MET:'Metionina',PHE:'Fenilalanina',PRO:'Prolina',SER:'Serina',THR:'Treonina',TRP:'Triptófano',TYR:'Tirosina',VAL:'Valina',
  DA:'Adenina (A)',DT:'Timina (T)',DG:'Guanina (G)',DC:'Citosina (C)',HEM:'Grupo hemo',XK2:'Inhibidor XK263',CSO:'Cisteína modificada'};
function hover(chainNames){
  viewer.setHoverable({}, true, (atom, v) => {
    if (!atom || atom.__lbl) return;
    v.removeAllLabels();
    const res = AA[atom.resn] || atom.resn;
    const ch = chainNames && chainNames[atom.chain] ? ' · ' + chainNames[atom.chain] : '';
    v.addLabel(`${res} ${atom.resi || ''}${ch}`, { position: { x: atom.x, y: atom.y, z: atom.z }, backgroundColor: '#10313b', backgroundOpacity: 0.92,
      fontColor: '#ffffff', font: 'Segoe UI', fontSize: 13, borderColor: '#0fb3c2', borderThickness: 1, inFront: true });
    v.render();
  }, (atom, v) => { v.removeAllLabels(); if (molState.relabel) molState.relabel(); v.render(); });
  viewer.setHoverDuration(60);
}
function legend(items){ const l = $('legend'); const top = l.classList.contains('arriba'); l.innerHTML = items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join(''); l.className = 'legend show' + (top ? ' arriba' : ''); if (!top) placeLegend(); else l.style.bottom = ''; }
function placeLegend(){ setTimeout(() => { const f = document.querySelector('.mfoot'); if (f) $('legend').style.bottom = (f.offsetHeight + 6) + 'px'; }, 60); }

/* ADN-B 1BNA */
const BASECOL = { DA: '#ef5b5b', DT: '#4ea8ff', DG: '#4fd17a', DC: '#ffd23f' };
function molDNA(m){
  viewer.addModel(E[m.datos], 'pdb');
  setEvid('Estructura experimental · rayos X · PDB 1BNA');
  const styles = {
    helice: () => { viewer.setStyle({}, { cartoon: { color: '#3d7fd6', thickness: 0.6, opacity: 0.95 }, stick: { radius: 0.12, colorscheme: 'Jmol' } }); $('legend').className = 'legend'; },
    pares: () => { viewer.setStyle({}, { stick: { radius: 0.2, colorfunc: a => (/^(P|OP1|OP2|O5'|C5'|C4'|O4'|C3'|O3'|C2'|C1')$/.test(a.atom) ? '#8796a8' : (BASECOL[a.resn] || '#ccc')) } });
      legend([[BASECOL.DA, 'A · adenina'], [BASECOL.DT, 'T · timina'], [BASECOL.DG, 'G · guanina'], [BASECOL.DC, 'C · citosina'], ['#8796a8', 'esqueleto azúcar-fosfato']]); },
    esferas: () => { viewer.setStyle({}, { sphere: { colorscheme: 'Jmol', scale: 0.95 } }); $('legend').className = 'legend'; }
  };
  const g = group(); const bs = [];
  bs.push(chip('Doble hélice', b => { radio(bs, b); styles.helice(); viewer.render(); }, { on: true, parent: g }));
  bs.push(chip('Pares de bases', b => { radio(bs, b); styles.pares(); viewer.render(); }, { parent: g }));
  bs.push(chip('Átomos', b => { radio(bs, b); styles.esferas(); viewer.render(); }, { parent: g }));
  styles.helice(); hover(); viewer.zoomTo(); viewer.rotate(90, 'x'); viewer.render();
}

/* Nucleosoma 1KX5 */
const HIST = { A: 'Histona H3', E: 'Histona H3', B: 'Histona H4', F: 'Histona H4', C: 'Histona H2A', G: 'Histona H2A', D: 'Histona H2B', H: 'Histona H2B', I: 'ADN', J: 'ADN' };
const HCOL = { A: '#5b8def', E: '#5b8def', B: '#4fd17a', F: '#4fd17a', C: '#f2c14e', G: '#f2c14e', D: '#ef6f9a', H: '#ef6f9a' };
function molNucleo(m){
  viewer.addModel(E[m.datos], 'pdb');
  setEvid('Estructura experimental · rayos X · PDB 1KX5');
  const prot = { chain: ['A','B','C','D','E','F','G','H'] }, dna = { chain: ['I', 'J'] };
  const st = {
    todo: () => { viewer.removeAllSurfaces(); viewer.setStyle(prot, { cartoon: { colorfunc: a => HCOL[a.chain] } }); viewer.setStyle(dna, { cartoon: { color: '#ff9f43' }, stick: { radius: 0.1, color: '#ffb870' } }); },
    adn: () => { viewer.removeAllSurfaces(); viewer.setStyle(prot, {}); viewer.setStyle(dna, { cartoon: { color: '#ff9f43' }, stick: { radius: 0.16, colorscheme: 'Jmol' } }); },
    sup: () => { st.todo(); viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.75, colorscheme: { prop: 'chain', map: HCOL } }, prot, prot); }
  };
  const g = group(); const bs = [];
  bs.push(chip('ADN + histonas', b => { radio(bs, b); st.todo(); viewer.render(); }, { on: true, parent: g }));
  bs.push(chip('Solo ADN', b => { radio(bs, b); st.adn(); viewer.render(); }, { parent: g }));
  bs.push(chip('Superficie', b => { radio(bs, b); st.sup(); viewer.render(); }, { parent: g }));
  legend([['#ff9f43', 'ADN (147 pares de bases)'], [HCOL.A, 'H3'], [HCOL.B, 'H4'], [HCOL.C, 'H2A'], [HCOL.D, 'H2B']]);
  st.todo(); hover(HIST); viewer.zoomTo(); viewer.render();
}

/* Aminoácidos (PubChem) con partes coloreadas */
const AMINOS = [
  { cid: 750, code: 'Gly', name: 'Glicina', note: 'La más pequeña: su cadena lateral es solo un hidrógeno.' },
  { cid: 5950, code: 'Ala', name: 'Alanina', note: 'Cadena lateral pequeña (–CH₃), no polar.' },
  { cid: 6287, code: 'Val', name: 'Valina', note: 'Cadena ramificada que “evita” el agua (hidrofóbica).' },
  { cid: 5951, code: 'Ser', name: 'Serina', note: 'Tiene un –OH que puede formar puentes de hidrógeno.' },
  { cid: 5862, code: 'Cys', name: 'Cisteína', note: 'Tiene azufre (–SH); dos cisteínas pueden unirse con un puente disulfuro.' },
  { cid: 6140, code: 'Phe', name: 'Fenilalanina', note: 'Anillo aromático voluminoso, hidrofóbico.' },
  { cid: 6305, code: 'Trp', name: 'Triptófano', note: 'Doble anillo: de las cadenas laterales más grandes.' }
];
function aminoParts(atoms){
  const nb = a => a.bonds.map(i => atoms[i]);
  const carbC = atoms.find(a => a.elem === 'C' && nb(a).filter(x => x.elem === 'O').length >= 2);
  const ca = carbC && nb(carbC).find(a => a.elem === 'C' && nb(a).some(x => x.elem === 'N'));
  const n = ca && nb(ca).find(a => a.elem === 'N');
  const part = {};
  if (!ca) return part;
  part[ca.index] = 'ca';
  [carbC, ...nb(carbC).filter(x => x.elem === 'O')].forEach(a => { part[a.index] = 'cooh'; nb(a).filter(x => x.elem === 'H').forEach(h => part[h.index] = 'cooh'); });
  part[n.index] = 'nh2'; nb(n).filter(x => x.elem === 'H').forEach(h => part[h.index] = 'nh2');
  // cadena lateral: todo lo que cuelga del Cα excepto los grupos anteriores
  const side = nb(ca).filter(a => !part[a.index]);
  let hs = side.filter(a => a.elem === 'H');
  let heavy = side.filter(a => a.elem !== 'H');
  if (!heavy.length && hs.length) { // glicina: R = H (uno de los dos H)
    part[hs[0].index] = 'r'; if (hs[1]) part[hs[1].index] = 'ha';
  } else {
    hs.forEach(h => part[h.index] = 'ha');
    const stack = heavy.slice();
    while (stack.length) { const a = stack.pop(); if (part[a.index]) continue; part[a.index] = 'r'; nb(a).forEach(x => { if (!part[x.index]) stack.push(x); }); }
  }
  return part;
}
const PCOL = { ca: '#ffd23f', nh2: '#4ea8ff', cooh: '#ff5d5d', r: '#4fd17a', ha: '#d7dee8' };
function molAmino(m){
  setEvid('Modelo 3D · PubChem (NIH) · configuración L', 'chem');
  const g = group(); const bs = [];
  let active = molState.aminoIdx || 0;
  AMINOS.forEach((a, i) => bs.push(chip(a.code, b => { radio(bs, b); active = i; draw(); }, { on: i === active, parent: g, title: a.name })));
  const modeG = group(); const ms = []; let colorParts = true;
  ms.push(chip('Partes', b => { radio(ms, b); colorParts = true; draw(); }, { on: true, parent: modeG }));
  ms.push(chip('Colores químicos', b => { radio(ms, b); colorParts = false; draw(); }, { parent: modeG }));
  function draw(){
    const a = AMINOS[active]; molState.aminoIdx = active;
    viewer.clear(); viewer.removeAllLabels();
    const model = viewer.addModel(E['CID' + a.cid], 'sdf');
    const atoms = model.selectedAtoms({});
    const part = aminoParts(atoms);
    if (colorParts) {
      viewer.setStyle({}, { stick: { radius: 0.17, colorfunc: x => PCOL[part[x.index] || 'ha'] }, sphere: { scale: 0.3, colorfunc: x => PCOL[part[x.index] || 'ha'] } });
      legend([[PCOL.ca, 'Carbono alfa (Cα)'], [PCOL.nh2, 'Grupo amino'], [PCOL.cooh, 'Grupo carboxilo'], [PCOL.r, 'Cadena lateral (R)']]);
    } else {
      viewer.setStyle({}, { stick: { radius: 0.17, colorscheme: 'Jmol' }, sphere: { scale: 0.3, colorscheme: 'Jmol' } });
      legend([['#909090', 'C carbono'], ['#ffffff', 'H hidrógeno'], ['#3050f8', 'N nitrógeno'], ['#ff0d0d', 'O oxígeno'], ['#ffff30', 'S azufre']]);
    }
    const lbl = (key, text) => { const xs = atoms.filter(x => part[x.index] === key && x.elem !== 'H'); const ys = xs.length ? xs : atoms.filter(x => part[x.index] === key); if (!ys.length) return;
      const c = ys.reduce((p, x) => ({ x: p.x + x.x / ys.length, y: p.y + x.y / ys.length, z: p.z + x.z / ys.length }), { x: 0, y: 0, z: 0 });
      viewer.addLabel(text, { position: c, backgroundColor: PCOL[key], backgroundOpacity: 0.92, fontColor: '#07111f', font: 'Segoe UI', fontSize: 13, inFront: true, alignment: 'center' }); };
    molState.relabel = () => { if (!colorParts) return; lbl('ca', 'Cα'); lbl('nh2', 'grupo amino'); lbl('cooh', 'grupo carboxilo'); lbl('r', active === 0 ? 'R = H' : 'cadena lateral R'); };
    molState.relabel();
    const p = $('pick'); p.innerHTML = `${a.name} (${a.code}) · PubChem CID ${a.cid}<small>${a.note}</small>`; p.className = 'pick show';
    viewer.zoomTo(); viewer.zoom(0.85); viewer.render();
  }
  draw();
}

/* Hemoglobina 4HHB */
const HBC = { A: '#ef5b5b', C: '#ff9a8b', B: '#4ea8ff', D: '#8cc8ff' };
const HBN = { A: 'cadena α1', B: 'cadena β1', C: 'cadena α2', D: 'cadena β2' };
function molProt(m){
  viewer.addModel(E[m.datos], 'pdb');
  setEvid('Estructura experimental · rayos X · PDB 4HHB');
  const P = { hetflag: false }, H = { resn: 'HEM' };
  const st = {
    cad: () => { viewer.removeAllSurfaces(); viewer.setStyle({}, {}); viewer.setStyle(P, { cartoon: { colorfunc: a => HBC[a.chain] } }); viewer.setStyle(H, { stick: { radius: 0.22, colorscheme: 'Jmol' } });
      legend([[HBC.A, 'α1'], [HBC.C, 'α2'], [HBC.B, 'β1'], [HBC.D, 'β2'], ['#ff8c00', 'grupos hemo']]); },
    hemo: () => { viewer.removeAllSurfaces(); viewer.setStyle({}, {}); viewer.setStyle(P, { cartoon: { colorfunc: a => HBC[a.chain], opacity: 0.45 } });
      viewer.setStyle(H, { stick: { radius: 0.3, colorscheme: 'orangeCarbon' } }); viewer.addStyle({ resn: 'HEM', elem: 'Fe' }, { sphere: { radius: 1.1, color: '#ff6a00' } });
      legend([['#ff6a00', 'hierro (Fe) donde se une el O₂'], ['#ffa94d', 'grupo hemo']]); },
    sup: () => { st.cad(); viewer.addSurface($3Dmol.SurfaceType.SAS, { opacity: 0.85, colorscheme: { prop: 'chain', map: HBC } }, P, P); },
    arco: () => { viewer.removeAllSurfaces(); viewer.setStyle({}, {}); viewer.setStyle(P, { cartoon: { color: 'spectrum' } }); viewer.setStyle(H, { stick: { radius: 0.2 } }); legend([['linear-gradient(90deg,#00f,#0f0,#f00)', 'del inicio al final de cada cadena']]); }
  };
  const g = group(); const bs = [];
  bs.push(chip('Cadenas', b => { radio(bs, b); st.cad(); viewer.render(); }, { on: true, parent: g }));
  bs.push(chip('Grupos hemo', b => { radio(bs, b); st.hemo(); viewer.render(); }, { parent: g }));
  bs.push(chip('Superficie', b => { radio(bs, b); st.sup(); viewer.render(); }, { parent: g }));
  bs.push(chip('Arcoíris', b => { radio(bs, b); st.arco(); viewer.render(); }, { parent: g }));
  st.cad(); hover(HBN); viewer.zoomTo(); viewer.render();
}

/* AlphaFold P69905 coloreado por pLDDT + comparación con 4HHB (cadena A) */
const PL = b => b > 90 ? '#0053d6' : b > 70 ? '#65cbf3' : b > 50 ? '#ffdb13' : '#ff7d45';
function parseCA(text, chain){
  const out = {};
  text.split('\n').forEach(l => { if (l.startsWith('ATOM') && l.substr(12, 4).trim() === 'CA' && (!chain || l[21] === chain)) out[+l.substr(22, 4)] = [+l.substr(30, 8), +l.substr(38, 8), +l.substr(46, 8)]; });
  return out;
}
function jacobi4(A){ // autovalores/autovectores de matriz simétrica 4x4
  const n = 4, V = [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1]], a = A.map(r => r.slice());
  for (let sweep = 0; sweep < 60; sweep++){
    let off = 0; for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] * a[p][q];
    if (off < 1e-14) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++){
      if (Math.abs(a[p][q]) < 1e-14) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++){ const akp = a[k][p], akq = a[k][q]; a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq; }
      for (let k = 0; k < n; k++){ const apk = a[p][k], aqk = a[q][k]; a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk; }
      for (let k = 0; k < n; k++){ const vkp = V[k][p], vkq = V[k][q]; V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq; }
    }
  }
  return { vals: [0,1,2,3].map(i => a[i][i]), vecs: V };
}
function superpose(P, Q){ // mueve P sobre Q (método de cuaterniones de Horn)
  const n = P.length, cen = X => X.reduce((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  const cp = cen(P), cq = cen(Q);
  const M = [[0,0,0],[0,0,0],[0,0,0]];
  for (let k = 0; k < n; k++) for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) M[i][j] += (P[k][i] - cp[i]) * (Q[k][j] - cq[j]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = M;
  const N = [[xx + yy + zz, yz - zy, zx - xz, xy - yx], [yz - zy, xx - yy - zz, xy + yx, zx + xz], [zx - xz, xy + yx, -xx + yy - zz, yz + zy], [xy - yx, zx + xz, yz + zy, -xx - yy + zz]];
  const { vals, vecs } = jacobi4(N); let bi = 0; for (let i = 1; i < 4; i++) if (vals[i] > vals[bi]) bi = i;
  const [q0, q1, q2, q3] = [0, 1, 2, 3].map(i => vecs[i][bi]);
  const R = [[q0*q0+q1*q1-q2*q2-q3*q3, 2*(q1*q2-q0*q3), 2*(q1*q3+q0*q2)], [2*(q1*q2+q0*q3), q0*q0-q1*q1+q2*q2-q3*q3, 2*(q2*q3-q0*q1)], [2*(q1*q3-q0*q2), 2*(q2*q3+q0*q1), q0*q0-q1*q1-q2*q2+q3*q3]];
  const RT = [[R[0][0], R[1][0], R[2][0]], [R[0][1], R[1][1], R[2][1]], [R[0][2], R[1][2], R[2][2]]];
  const ap = (Rm, p) => { const d = [p[0] - cp[0], p[1] - cp[1], p[2] - cp[2]]; return [0, 1, 2].map(i => Rm[i][0] * d[0] + Rm[i][1] * d[1] + Rm[i][2] * d[2] + cq[i]); };
  const rmsd = Rm => Math.sqrt(P.reduce((s, p, k) => { const x = ap(Rm, p); return s + (x[0] - Q[k][0]) ** 2 + (x[1] - Q[k][1]) ** 2 + (x[2] - Q[k][2]) ** 2; }, 0) / n);
  const r1 = rmsd(R), r2 = rmsd(RT); // se elige la convención correcta comprobando el resultado
  const Rb = r1 <= r2 ? R : RT;
  return { apply: p => ap(Rb, p), rmsd: Math.min(r1, r2), n };
}
function transformPDB(text, chain, f){
  return text.split('\n').filter(l => /^(ATOM|HETATM)/.test(l) && l[21] === chain && l.substr(17, 3) !== 'HOH').map(l => {
    const p = f([+l.substr(30, 8), +l.substr(38, 8), +l.substr(46, 8)]);
    return l.substr(0, 30) + p.map(v => v.toFixed(3).padStart(8)).join('') + l.substr(54);
  }).join('\n');
}
function molAF(m){
  const afModel = viewer.addModel(E[m.datos], 'pdb');
  setEvid('Predicción computacional · AlphaFold DB · no es experimental', 'pred');
  const draw = conf => { viewer.setStyle({ model: afModel }, { cartoon: conf ? { colorfunc: a => PL(a.b) } : { color: '#0fb3c2' } }); };
  let cmp = null;
  const g = group(); const bs = [];
  bs.push(chip('Color por confianza', b => { radio(bs, b); draw(true); viewer.render(); }, { on: true, parent: g }));
  bs.push(chip('Un solo color', b => { radio(bs, b); draw(false); viewer.render(); }, { parent: g }));
  chip('Comparar con rayos X', b => {
    if (cmp) { viewer.removeModel(cmp); cmp = null; b.classList.remove('on'); $('hud').className = 'hud'; viewer.render(); return; }
    const af = parseCA(E[m.datos]), ex = parseCA(E[m.comparar], 'A');
    const P = [], Q = [];
    Object.keys(ex).forEach(r => { const ra = +r + 1; if (af[ra]) { P.push(ex[r]); Q.push(af[ra]); } }); // la predicción incluye la Met inicial: residuo n+1
    const sp = superpose(P, Q);
    cmp = viewer.addModel(transformPDB(E[m.comparar], 'A', sp.apply), 'pdb');
    viewer.setStyle({ model: cmp }, { cartoon: { color: '#6b7a88', opacity: 0.8, thickness: 0.3 } });
    viewer.render(); b.classList.add('on');
    const h = $('hud');
    h.innerHTML = `<div class="row"><span>Predicción (color) vs. experimento (gris)</span></div><div class="big">RMSD = ${sp.rmsd.toFixed(2)} Å</div>
      <div class="note">Diferencia promedio entre ${sp.n} carbonos alfa después de superponer la predicción AF-P69905 y la cadena α de 4HHB. 1 Å = 0.0000001 mm.</div>`;
    h.className = 'hud show';
  }, { cls: 'warm' });
  legend([[PL(95), 'muy alta (>90)'], [PL(80), 'alta (70–90)'], [PL(60), 'baja (50–70)'], [PL(40), 'muy baja (<50)']]);
  draw(true); hover(); viewer.zoomTo(); viewer.render();
}

/* Docking interactivo: proteasa del VIH-1 + XK263 (1HVR) */
function molDock(m){
  setEvid('Estructura experimental · rayos X · PDB 1HVR · interacción didáctica');
  const lines = E[m.datos].split('\n');
  const isLig = l => /^HETATM/.test(l) && l.substr(17, 3) === m.ligando;
  const ligLines = lines.filter(isLig);
  const ligSerials = new Set(ligLines.map(l => +l.substr(6, 5)));
  const conect = lines.filter(l => l.startsWith('CONECT') && ligSerials.has(+l.substr(6, 5)));
  const protText = lines.filter(l => /^(ATOM|HETATM)/.test(l) && !isLig(l)).join('\n');
  const prot = viewer.addModel(protText, 'pdb');
  viewer.setStyle({ model: prot }, { cartoon: { colorfunc: a => a.chain === 'A' ? '#5b8def' : '#9b8cff', opacity: 0.92 } });
  const protAtoms = prot.selectedAtoms({}).filter(a => a.elem !== 'H');
  const orig = ligLines.map(l => [+l.substr(30, 8), +l.substr(38, 8), +l.substr(46, 8)]);
  const elems = ligLines.map(l => (l.substr(76, 2).trim() || l.substr(12, 2).trim()).toUpperCase());
  const centroid = X => X.reduce((s, p) => [s[0] + p[0] / X.length, s[1] + p[1] / X.length, s[2] + p[2] / X.length], [0, 0, 0]);
  const c0 = centroid(orig);
  // residuos del bolsillo (para la superficie) según la pose experimental
  const pocket = [...new Set(protAtoms.filter(a => orig.some(p => (a.x - p[0]) ** 2 + (a.y - p[1]) ** 2 + (a.z - p[2]) ** 2 < 49)).map(a => a.serial))];
  // dirección de salida: hacia las "solapas" (Ile50 de ambas cadenas)
  const flap = protAtoms.filter(a => a.resi === 50 && a.atom === 'CA');
  let out = flap.length ? centroid(flap.map(a => [a.x, a.y, a.z])).map((v, i) => v - c0[i]) : [0, 0, 1];
  const nrm = Math.hypot(...out) || 1; out = out.map(v => v / nrm);
  let cur3 = orig.map(p => p.slice()), lig = null, surf = false;
  molState.focus = { model: prot };

  function ligText(){ return ligLines.map((l, i) => l.substr(0, 30) + cur3[i].map(v => v.toFixed(3).padStart(8)).join('') + l.substr(54)).join('\n') + '\n' + conect.join('\n'); }
  function score(){
    let contacts = 0, clashes = 0, polar = 0; const pairs = [];
    cur3.forEach((p, i) => {
      if (elems[i] === 'H') return;
      let near = false;
      for (const a of protAtoms){
        const d2 = (a.x - p[0]) ** 2 + (a.y - p[1]) ** 2 + (a.z - p[2]) ** 2;
        if (d2 > 16) continue;
        near = true;
        if (d2 < 6.25) clashes++;
        else if (d2 < 10.89 && /^[NO]$/.test(elems[i]) && /^[NO]$/.test(a.elem)) { polar++; pairs.push([p, a]); }
      }
      if (near) contacts++;
    });
    return { contacts, clashes, polar, pairs };
  }
  function redraw(){
    if (lig) viewer.removeModel(lig);
    lig = viewer.addModel(ligText(), 'pdb');
    viewer.setStyle({ model: lig }, { stick: { radius: 0.27, colorscheme: 'yellowCarbon' } });
    viewer.removeAllShapes();
    const sc = score();
    sc.pairs.slice(0, 20).forEach(([p, a]) => viewer.addCylinder({ start: { x: p[0], y: p[1], z: p[2] }, end: { x: a.x, y: a.y, z: a.z }, radius: 0.07, dashed: true, color: '#ffd23f', fromCap: 1, toCap: 1 }));
    const heavy = elems.filter(e => e !== 'H').length;
    const dist = Math.hypot(...centroid(cur3).map((v, i) => v - c0[i]));
    $('hud').innerHTML = `
      <div class="row"><span>Contactos (átomos a &lt; 4 Å)</span><b>${sc.contacts} / ${heavy}</b></div><div class="bar"><i style="width:${100 * sc.contacts / heavy}%;background:#38d3c5"></i></div>
      <div class="row"><span>Choques (&lt; 2.5 Å)</span><b style="color:${sc.clashes ? '#ff6b6b' : '#4fd17a'}">${sc.clashes}</b></div><div class="bar"><i style="width:${Math.min(100, sc.clashes * 4)}%;background:#ff6b6b"></i></div>
      <div class="row"><span>Posibles puentes de H (N/O &lt; 3.3 Å)</span><b>${sc.polar}</b></div>
      <div class="row"><span>Distancia a la pose experimental</span><b>${dist.toFixed(1)} Å</b></div>
      <div class="note">Conteo geométrico didáctico. Los programas de docking usan funciones de puntuación físico-químicas más completas; ninguna demuestra por sí sola que una molécula sea un medicamento.</div>`;
    $('hud').className = 'hud show';
    viewer.render();
  }
  // ejes de pantalla en coordenadas del modelo (a partir de la proyección actual)
  function screenAxes(){
    const c = centroid(cur3), s0 = viewer.modelToScreen({ x: c[0], y: c[1], z: c[2] });
    const d = [[1,0,0],[0,1,0],[0,0,1]].map(e => { const s = viewer.modelToScreen({ x: c[0] + e[0], y: c[1] + e[1], z: c[2] + e[2] }); return [s.x - s0.x, s.y - s0.y]; });
    let right = [d[0][0], d[1][0], d[2][0]], up = [-d[0][1], -d[1][1], -d[2][1]];
    const n1 = Math.hypot(...right) || 1, n2 = Math.hypot(...up) || 1; right = right.map(v => v / n1); up = up.map(v => v / n2);
    const depth = [right[1] * up[2] - right[2] * up[1], right[2] * up[0] - right[0] * up[2], right[0] * up[1] - right[1] * up[0]];
    return { right, up, depth };
  }
  function move(dirName, step){ const ax = screenAxes()[dirName]; cur3 = cur3.map(p => p.map((v, i) => v + ax[i] * step)); redraw(); }
  function rot(dirName, deg){
    const k = screenAxes()[dirName], th = deg * Math.PI / 180, c = centroid(cur3), co = Math.cos(th), si = Math.sin(th);
    cur3 = cur3.map(p => { const v = p.map((x, i) => x - c[i]); const kv = k[0] * v[0] + k[1] * v[1] + k[2] * v[2];
      const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
      return v.map((x, i) => x * co + cr[i] * si + k[i] * kv * (1 - co) + c[i]); });
    redraw();
  }
  const g1 = group();
  chip('Sacar la molécula', () => { cur3 = orig.map(p => p.map((v, i) => v + out[i] * 16)); redraw(); viewer.zoomTo({ model: prot }); viewer.render(); }, { parent: g1, cls: 'warm' });
  chip('Pose experimental', () => { cur3 = orig.map(p => p.slice()); redraw(); }, { parent: g1 });
  chip('Bolsillo', b => { surf = !surf; b.classList.toggle('on', surf); viewer.removeAllSurfaces(); if (surf) viewer.addSurface($3Dmol.SurfaceType.VDW, { opacity: 0.55, color: '#b8c7d9' }, { model: prot, serial: pocket }, { model: prot }); viewer.render(); }, { parent: g1 });
  const g2 = group();
  chip('Izquierda', () => move('right', -1), { parent: g2, title: 'Mover a la izquierda 1 Å' });
  chip('Derecha', () => move('right', 1), { parent: g2, title: 'Mover a la derecha 1 Å' });
  chip('Arriba', () => move('up', 1), { parent: g2, title: 'Subir 1 Å' });
  chip('Abajo', () => move('up', -1), { parent: g2, title: 'Bajar 1 Å' });
  chip('Fondo', () => move('depth', 1), { parent: g2, title: 'Hacia el fondo / hacia ti' });
  chip('Rotar', () => rot('up', -15), { parent: g2, title: 'Girar la molécula 15°' });
  chip('Voltear', () => rot('right', 15), { parent: g2, title: 'Voltear la molécula 15°' });
  legend([['#5b8def', 'cadena A'], ['#9b8cff', 'cadena B'], ['#f6d743', 'XK263 (inhibidor)'], ['#ffd23f', 'líneas punteadas: posibles puentes de H']]);
  redraw(); hover({ A: 'proteasa, cadena A', B: 'proteasa, cadena B' });
  viewer.zoomTo({ model: prot }); viewer.render();
}

/* =========================================================================
   VENTANA DEL PRESENTADOR (sincronizada)
   ========================================================================= */
function broadcast(){ if (chan && !PRESENTER) chan.postMessage({ type: 'state', cur, msgI, clipI, t0 }); }
function renderPresenter(){
  const s = S[cur], p = $('presenter');
  const sec = t0 ? (Date.now() - t0) / 1000 : 0;
  p.innerHTML = `
   <div class="col">
     <div class="k">${esc(s.kicker)} · ${esc(s.tiempo)}</div>
     <h2>${esc(s.num)} · ${esc(s.titulo)}</h2>
     <div class="ctl"><button data-c="prev">Anterior</button><button class="main" data-c="next">Siguiente</button><button data-c="clip">Cambiar video</button><button data-c="q">Mostrar/ocultar pregunta</button></div>
     <div class="now">Ahora en pantalla: ${s.mensajes[msgI]}</div>
     <ol>${s.mensajes.map((t, k) => `<li class="${k === msgI ? 'on' : ''}">${t}</li>`).join('')}</ol>
     <div class="guion">${s.guion}</div>
   </div>
   <div class="col">
     <div class="k">TIEMPO</div><div class="big">${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(Math.floor(sec % 60)).padStart(2, '0')}</div>
     <div class="nxt">Objetivo de esta parte: ${esc(s.tiempo)}</div>
     <p class="notes-q">Pregunta: ${esc(s.pregunta)}</p>
     <div class="k" style="margin-top:16px">SIGUIENTE DIAPOSITIVA</div>
     <div class="nxt">${S[cur + 1] ? esc(S[cur + 1].num + ' · ' + S[cur + 1].titulo) : 'Fin'}</div>
     <div class="k" style="margin-top:16px">VIDEO EN PANTALLA</div>
     <div class="nxt">${s.videos[clipI] ? esc(s.videos[clipI].titulo) : ''}</div>
     <div class="k" style="margin-top:16px">RECORRIDO</div>
     <div class="ctl">${S.map((x, i) => `<button data-g="${i}" class="${i === cur ? 'main' : ''}">${x.num} ${esc(x.corto)}</button>`).join('')}</div>
   </div>`;
  p.querySelectorAll('[data-c]').forEach(b => b.onclick = () => chan && chan.postMessage({ type: 'cmd', cmd: b.dataset.c }));
  p.querySelectorAll('[data-g]').forEach(b => b.onclick = () => chan && chan.postMessage({ type: 'cmd', cmd: 'goto', i: +b.dataset.g }));
}
function initPresenter(){
  document.title = 'Presentador · ' + document.title;
  $('stage').style.display = 'none'; $('presenter').hidden = false;
  renderPresenter(); setInterval(renderPresenter, 1000);
  if (chan) chan.onmessage = e => { const d = e.data; if (d.type === 'state') { cur = d.cur; msgI = d.msgI; clipI = d.clipI; t0 = d.t0; renderPresenter(); } };
  if (chan) chan.postMessage({ type: 'hello' });
  document.addEventListener('keydown', e => { if (!chan) return; if (['ArrowRight', 'PageDown', ' '].includes(e.key)) chan.postMessage({ type: 'cmd', cmd: 'next' }); if (['ArrowLeft', 'PageUp'].includes(e.key)) chan.postMessage({ type: 'cmd', cmd: 'prev' }); });
}

/* =========================================================================
   TECLADO E INICIO
   ========================================================================= */
function onKey(e){
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key;
  if (['ArrowRight', 'PageDown', ' ', 'Enter'].includes(k)) { e.preventDefault(); e.stopPropagation(); next(); }
  else if (['ArrowLeft', 'PageUp', 'Backspace'].includes(k)) { e.preventDefault(); e.stopPropagation(); prev(); }
  else if (k === 'Home') go(0);
  else if (k === 'End') go(S.length - 1);
  else if (/^[0-9]$/.test(k)) go(+k);
  else if (k === 'v' || k === 'V') { const n = S[cur].videos.length; if (n > 1) { clipI = (clipI + 1) % n; loadClip(); broadcast(); } }
  else if (k === 'q' || k === 'Q') toggleQ();
  else if (k === 'n' || k === 'N') toggle('notes');
  else if (k === 'r' || k === 'R') toggle('biblio');
  else if (k === 'h' || k === 'H' || k === '?') toggle('help');
  else if (k === 'p' || k === 'P') window.open(location.href.split('#')[0] + '#presentador', 'presentador', 'width=1200,height=800');
  else if (k === 'f' || k === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
  else if (k === 't' || k === 'T') startClock();
  else if (k === 'a' || k === 'A') { if (mv && mv.parentNode) { mv.hasAttribute('auto-rotate') ? mv.removeAttribute('auto-rotate') : mv.setAttribute('auto-rotate', ''); } else if (viewer) { molState.spin = !molState.spin; viewer.spin(molState.spin ? 'y' : false, 0.6); } }
  else if (k === 'Escape') { ['notes', 'biblio', 'help', 'qcard'].forEach(id => $(id).hidden = true); }
}
function toggleQ(){ toggle('qcard'); }
function printScript(){
  const w = window.open('', 'guion');
  const body = S.map(s => `<section><h2>${s.num} · ${esc(s.titulo)} <small>(${esc(s.tiempo)})</small></h2>
    <h3>Mensajes en pantalla</h3><ol>${s.mensajes.map(m => `<li>${m}</li>`).join('')}</ol>
    <h3>Monólogo</h3>${s.guion}<p><b>Pregunta:</b> ${esc(s.pregunta)}</p>
    <h3>Referencias de la diapositiva</h3><ul>${s.refs.map(r => `<li>${REF[r] || r}</li>`).join('')}</ul></section>`).join('<hr>');
  w.document.write(`<!doctype html><meta charset="utf-8"><title>Guion · ${esc(C.titulo)}</title><style>body{font:15px/1.55 Segoe UI,Arial,sans-serif;max-width:820px;margin:30px auto;color:#111}h2{margin:24px 0 6px}h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#356}.cue{color:#0a7a70;font-style:italic}li{margin:3px 0}ul li{padding-left:2em;text-indent:-2em;list-style:none}</style><h1>${esc(C.titulo)}</h1><p>${esc(C.autoria)}</p>${body}`);
  w.document.close();
}
function init(){
  if (PRESENTER) { initPresenter(); return; }
  buildJourney(); renderBiblio();
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('click', e => { const b = e.target.closest && e.target.closest('button'); if (b) setTimeout(() => b.blur(), 0); });
  document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(b.dataset.close).hidden = true);
  $('printBtn').onclick = printScript;
  $('clock').onclick = startClock;
  $('qbtn').onclick = toggleQ;
  $('prevBtn').onclick = prev;
  $('nextBtn').onclick = next;
  $('qcard').onclick = toggleQ;
  if (chan) chan.onmessage = e => { const d = e.data;
    if (d.type === 'hello') broadcast();
    if (d.type === 'cmd') { if (d.cmd === 'next') next(); if (d.cmd === 'prev') prev(); if (d.cmd === 'goto') go(d.i); if (d.cmd === 'q') toggleQ(); if (d.cmd === 'clip') { const n = S[cur].videos.length; clipI = (clipI + 1) % n; loadClip(); broadcast(); } } };
  const startAt = parseInt((location.hash.match(/^#(\d+)$/) || [])[1] || '0', 10);
  go(startAt);
  tickClock();
  setTimeout(preloadGLBs, 1500);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
