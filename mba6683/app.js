/* =============================================
   MBA6683 SIM FLIPBOOK
   Chunk-based Base64 loading — works inside any iframe
   No external image requests — Moodle compatible
   ============================================= */
'use strict';

const TOTAL_PAGES  = 236;
const CHUNK_SIZE   = 10;
const TOTAL_CHUNKS = 24;
const DPR = Math.min(window.devicePixelRatio || 1, 3);

let currentSpread = 0;
let isFlipping    = false;
let isMobile      = window.innerWidth <= 640;
let zoomLevel     = 1.0;
let imageCache    = {};      // pageNum -> HTMLImageElement
let chunkLoaded   = {};      // chunkNum -> true/false
let chunkLoading  = {};      // chunkNum -> Promise

/* ---- DOM refs ---- */
const loadingScreen     = document.getElementById('loadingScreen');
const loadingBar        = document.getElementById('loadingBar');
const loadingPct        = document.getElementById('loadingPct');
const flipbookContainer = document.getElementById('flipbookContainer');
const mobileViewer      = document.getElementById('mobileViewer');
const toolbar           = document.getElementById('toolbar');
const pageLeft          = document.getElementById('pageLeft');
const pageRight         = document.getElementById('pageRight');
const canvasLeft        = document.getElementById('canvasLeft');
const canvasRight       = document.getElementById('canvasRight');
const canvasMobile      = document.getElementById('canvasMobile');
const turningPage       = document.getElementById('turningPage');
const canvasTurning     = document.getElementById('canvasTurning');
const pageNumLeft       = document.getElementById('pageNumLeft');
const pageNumRight      = document.getElementById('pageNumRight');
const pageIndicator     = document.getElementById('pageIndicator');
const pageInput         = document.getElementById('pageInput');
const zoomLabel         = document.getElementById('zoomLabel');
const prevBtn           = document.getElementById('prevBtn');
const nextBtn           = document.getElementById('nextBtn');
const prevBtn2          = document.getElementById('prevBtn2');
const nextBtn2          = document.getElementById('nextBtn2');
const firstBtn          = document.getElementById('firstBtn');
const lastBtn           = document.getElementById('lastBtn');
const zoomInBtn         = document.getElementById('zoomInBtn');
const zoomOutBtn        = document.getElementById('zoomOutBtn');
const downloadBtn       = document.getElementById('downloadBtn');
const fullscreenBtn     = document.getElementById('fullscreenBtn');

/* ============================================================
   CHUNK LOADING
   Each chunk-XX.js sets window.__CHUNK_N__ = { "1": "data:...", ... }
   ============================================================ */
function pageToChunk(pageNum) {
  return Math.ceil(pageNum / CHUNK_SIZE);
}

function loadChunk(chunkNum) {
  if (chunkLoaded[chunkNum]) return Promise.resolve();
  if (chunkLoading[chunkNum]) return chunkLoading[chunkNum];

  chunkLoading[chunkNum] = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = `./chunks/chunk-${String(chunkNum).padStart(2,'0')}.js`;
    script.onload = () => {
      const data = window[`__CHUNK_${chunkNum}__`];
      if (data) {
        Object.entries(data).forEach(([pageNum, dataUrl]) => {
          const img = new Image();
          img.src = dataUrl;
          imageCache[parseInt(pageNum)] = img;
        });
        delete window[`__CHUNK_${chunkNum}__`]; // free memory
      }
      chunkLoaded[chunkNum] = true;
      resolve();
    };
    script.onerror = () => { chunkLoaded[chunkNum] = true; resolve(); };
    document.head.appendChild(script);
  });

  return chunkLoading[chunkNum];
}

async function ensurePageLoaded(pageNum) {
  if (pageNum < 1 || pageNum > TOTAL_PAGES) return;
  if (imageCache[pageNum]) return;
  await loadChunk(pageToChunk(pageNum));
}

/* ============================================================
   INIT
   ============================================================ */
async function init() {
  document.querySelector('.page-jump-sep').textContent = '/ ' + TOTAL_PAGES;
  pageInput.max = TOTAL_PAGES;

  // Load first chunk (pages 1-10)
  loadingBar.style.width = '30%';
  loadingPct.textContent = '30%';
  await loadChunk(1);

  loadingBar.style.width = '100%';
  loadingPct.textContent = '100%';

  await sleep(300);
  loadingScreen.style.opacity = '0';
  loadingScreen.style.transition = 'opacity 0.4s ease';
  await sleep(400);
  loadingScreen.style.display = 'none';
  toolbar.style.display = '';

  if (isMobile) {
    mobileViewer.style.display = '';
    await renderMobilePage(1);
  } else {
    flipbookContainer.style.display = '';
    await renderSpread(0);
  }

  // Load remaining chunks in background
  backgroundPreload();
}

async function backgroundPreload() {
  for (let c = 2; c <= TOTAL_CHUNKS; c++) {
    await loadChunk(c);
    await sleep(100);
  }
}

/* ============================================================
   DRAWING
   ============================================================ */
function getLogicalSize() {
  const stageH = window.innerHeight - 56 - 52;
  const stageW = window.innerWidth;
  const bookW  = (stageW - 120) / 2;
  const bookH  = stageH - 48;
  const scale  = Math.min(bookH / 842, bookW / 595, 3.0) * zoomLevel;
  return { w: Math.round(595 * scale), h: Math.round(842 * scale) };
}

function getMobileLogicalSize() {
  const stageH = window.innerHeight - 56 - 52;
  const stageW = window.innerWidth;
  const scale  = Math.min((stageH - 32) / 842, (stageW - 32) / 595) * zoomLevel;
  return { w: Math.round(595 * scale), h: Math.round(842 * scale) };
}

function drawToCanvas(canvas, img, logW, logH) {
  canvas.width  = logW * DPR;
  canvas.height = logH * DPR;
  canvas.style.width  = logW + 'px';
  canvas.style.height = logH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (img) ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}

/* ============================================================
   SPREAD RENDERING
   ============================================================ */
function spreadToPages(spread) {
  if (spread === 0) return { left: null, right: 1 };
  const l = spread * 2, r = spread * 2 + 1;
  return { left: l <= TOTAL_PAGES ? l : null, right: r <= TOTAL_PAGES ? r : null };
}

function pagesToSpread(p) { return p === 1 ? 0 : Math.floor(p / 2); }

async function renderSpread(spread) {
  const { w, h } = getLogicalSize();
  const { left, right } = spreadToPages(spread);

  await Promise.all([ensurePageLoaded(left), ensurePageLoaded(right)]);

  drawToCanvas(canvasLeft,  left  ? imageCache[left]  : null, w, h);
  drawToCanvas(canvasRight, right ? imageCache[right] : null, w, h);

  pageLeft.style.width = pageRight.style.width = w + 'px';
  pageLeft.style.height = pageRight.style.height = h + 'px';

  pageNumLeft.textContent  = left  || '';
  pageNumRight.textContent = right || '';
  const first = left || right;
  pageIndicator.textContent = left && right ? `Pages ${left}–${right} of ${TOTAL_PAGES}` : `Page ${first} of ${TOTAL_PAGES}`;
  pageInput.value = first;
  updateNavButtons();

  // Pre-ensure adjacent pages
  const { left: nl, right: nr } = spreadToPages(spread + 1);
  const { left: pl, right: pr } = spreadToPages(spread - 1);
  [nl, nr, pl, pr].filter(Boolean).forEach(ensurePageLoaded);
}

/* ============================================================
   MOBILE
   ============================================================ */
let mobilePage = 1;
async function renderMobilePage(pageNum) {
  mobilePage = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
  const { w, h } = getMobileLogicalSize();
  await ensurePageLoaded(mobilePage);
  drawToCanvas(canvasMobile, imageCache[mobilePage] || null, w, h);
  pageIndicator.textContent = `Page ${mobilePage} of ${TOTAL_PAGES}`;
  pageInput.value = mobilePage;
  updateNavButtons();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
async function goNext() {
  if (isFlipping) return;
  if (isMobile) { if (mobilePage < TOTAL_PAGES) await renderMobilePage(mobilePage + 1); return; }
  const maxSpread = Math.ceil((TOTAL_PAGES - 1) / 2);
  if (currentSpread >= maxSpread) return;
  isFlipping = true;
  await flipForward();
  currentSpread++;
  await renderSpread(currentSpread);
  isFlipping = false;
}

async function goPrev() {
  if (isFlipping) return;
  if (isMobile) { if (mobilePage > 1) await renderMobilePage(mobilePage - 1); return; }
  if (currentSpread <= 0) return;
  isFlipping = true;
  await flipBackward();
  currentSpread--;
  await renderSpread(currentSpread);
  isFlipping = false;
}

async function goToPage(p) {
  p = Math.max(1, Math.min(TOTAL_PAGES, p));
  if (isMobile) { await renderMobilePage(p); return; }
  currentSpread = pagesToSpread(p);
  await renderSpread(currentSpread);
}

async function goFirst() {
  currentSpread = 0; mobilePage = 1;
  isMobile ? await renderMobilePage(1) : await renderSpread(0);
}

async function goLast() {
  if (isMobile) { await renderMobilePage(TOTAL_PAGES); return; }
  currentSpread = Math.ceil((TOTAL_PAGES - 1) / 2);
  await renderSpread(currentSpread);
}

function updateNavButtons() {
  const max = Math.ceil((TOTAL_PAGES - 1) / 2);
  [prevBtn, prevBtn2, firstBtn].forEach(b => b.disabled = isMobile ? mobilePage <= 1 : currentSpread <= 0);
  [nextBtn, nextBtn2, lastBtn].forEach(b => b.disabled = isMobile ? mobilePage >= TOTAL_PAGES : currentSpread >= max);
}

/* ============================================================
   FLIP ANIMATION
   ============================================================ */
async function flipForward() {
  const w = parseInt(canvasLeft.style.width) || canvasLeft.width;
  const h = parseInt(canvasLeft.style.height) || canvasLeft.height;
  turningPage.style.cssText = `display:block;position:absolute;top:0;right:0;left:auto;width:${w}px;height:${h}px;transform:rotateY(0deg);transform-origin:left center;background:white;box-shadow:-4px 0 20px rgba(0,0,0,0.25);overflow:hidden;z-index:20;`;
  canvasTurning.width = canvasRight.width; canvasTurning.height = canvasRight.height;
  canvasTurning.style.width = w+'px'; canvasTurning.style.height = h+'px';
  canvasTurning.getContext('2d').drawImage(canvasRight, 0, 0);
  await sleep(20);
  turningPage.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
  turningPage.style.transform  = 'rotateY(-180deg)';
  await sleep(440);
  turningPage.style.cssText = 'display:none;';
}

async function flipBackward() {
  const w = parseInt(canvasLeft.style.width) || canvasLeft.width;
  const h = parseInt(canvasLeft.style.height) || canvasLeft.height;
  turningPage.style.cssText = `display:block;position:absolute;top:0;left:0;right:auto;width:${w}px;height:${h}px;transform:rotateY(-180deg);transform-origin:right center;background:white;box-shadow:4px 0 20px rgba(0,0,0,0.25);overflow:hidden;z-index:20;`;
  canvasTurning.width = canvasLeft.width; canvasTurning.height = canvasLeft.height;
  canvasTurning.style.width = w+'px'; canvasTurning.style.height = h+'px';
  canvasTurning.getContext('2d').drawImage(canvasLeft, 0, 0);
  await sleep(20);
  turningPage.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
  turningPage.style.transform  = 'rotateY(0deg)';
  await sleep(440);
  turningPage.style.cssText = 'display:none;';
}

/* ============================================================
   ZOOM / DOWNLOAD / FULLSCREEN
   ============================================================ */
async function setZoom(level) {
  zoomLevel = Math.max(0.5, Math.min(2.0, level));
  zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
  isMobile ? await renderMobilePage(mobilePage) : await renderSpread(currentSpread);
}

downloadBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = './assets/MBA6683-SIM-FINAL.pdf';
  a.download = 'MBA6683-SIM-FINAL.pdf'; a.target = '_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
});

fullscreenBtn.addEventListener('click', () => window.open(window.location.href, '_blank', 'noopener,noreferrer'));

/* ============================================================
   EVENT LISTENERS
   ============================================================ */
prevBtn.addEventListener('click', goPrev); nextBtn.addEventListener('click', goNext);
prevBtn2.addEventListener('click', goPrev); nextBtn2.addEventListener('click', goNext);
firstBtn.addEventListener('click', goFirst); lastBtn.addEventListener('click', goLast);
zoomInBtn.addEventListener('click', () => setZoom(zoomLevel + 0.2));
zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - 0.2));

pageInput.addEventListener('change', () => { const v = parseInt(pageInput.value,10); if(!isNaN(v)) goToPage(v); });
pageInput.addEventListener('keydown', e => { if(e.key==='Enter'){const v=parseInt(pageInput.value,10);if(!isNaN(v))goToPage(v);} });

document.addEventListener('keydown', e => {
  if (e.target === pageInput) return;
  if (['ArrowRight','ArrowDown','PageDown'].includes(e.key)) { e.preventDefault(); goNext(); }
  else if (['ArrowLeft','ArrowUp','PageUp'].includes(e.key)) { e.preventDefault(); goPrev(); }
  else if (e.key==='Home') { e.preventDefault(); goFirst(); }
  else if (e.key==='End')  { e.preventDefault(); goLast(); }
  else if (e.key==='+'||e.key==='=') setZoom(zoomLevel+0.2);
  else if (e.key==='-') setZoom(zoomLevel-0.2);
});

let tx=0;
document.addEventListener('touchstart', e=>{tx=e.touches[0].clientX;},{passive:true});
document.addEventListener('touchend',   e=>{const dx=e.changedTouches[0].clientX-tx; if(Math.abs(dx)>50){dx<0?goNext():goPrev();}},{passive:true});

let wt;
document.addEventListener('wheel', e=>{clearTimeout(wt);wt=setTimeout(()=>{e.deltaY>0?goNext():goPrev();},80);},{passive:true});

let rt;
window.addEventListener('resize', ()=>{
  clearTimeout(rt);
  rt=setTimeout(async()=>{
    const wasM=isMobile; isMobile=window.innerWidth<=640;
    if(isMobile!==wasM){
      if(isMobile){flipbookContainer.style.display='none';mobileViewer.style.display='';await renderMobilePage(1);}
      else{mobileViewer.style.display='none';flipbookContainer.style.display='';await renderSpread(currentSpread);}
    } else { isMobile?renderMobilePage(mobilePage):renderSpread(currentSpread); }
  },200);
});

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

/* ---- GO ---- */
init();
