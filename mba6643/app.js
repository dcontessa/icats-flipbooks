/* =============================================
   MBA6643 SIM FLIPBOOK
   Image-based — fast loading, no PDF parsing
   ============================================= */
'use strict';

/* ---- Config ---- */
const TOTAL_PAGES = 168;
const PAGE_DIR    = './pages/';
const PAGE_PREFIX = 'page-';
// Pages are named page-001.jpg ... page-168.jpg

/* ---- State ---- */
let currentSpread = 0;
let isFlipping    = false;
let isMobile      = window.innerWidth <= 640;
let zoomLevel     = 1.0;
let imageCache    = {}; // preloaded Image objects

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
   PAGE FILENAME HELPER
   ============================================================ */
function pageFile(n) {
  return PAGE_DIR + PAGE_PREFIX + String(n).padStart(3, '0') + '.jpg';
}

/* ============================================================
   IMAGE LOADING
   ============================================================ */
function loadImage(pageNum) {
  return new Promise((resolve) => {
    if (pageNum < 1 || pageNum > TOTAL_PAGES) { resolve(null); return; }
    if (imageCache[pageNum]) { resolve(imageCache[pageNum]); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => { imageCache[pageNum] = img; resolve(img); };
    img.onerror = () => {
      // Retry without crossOrigin (some servers block credentialed requests)
      const img2 = new Image();
      img2.onload  = () => { imageCache[pageNum] = img2; resolve(img2); };
      img2.onerror = () => resolve(null);
      img2.src = pageFile(pageNum) + '?t=' + Date.now();
    };
    img.src = pageFile(pageNum);
  });
}

function preloadImages(pageNums) {
  pageNums.forEach(n => { if (n >= 1 && n <= TOTAL_PAGES) loadImage(n); });
}

/* ============================================================
   INIT — preload first 6 pages then show
   ============================================================ */
async function init() {
  document.querySelector('.page-jump-sep').textContent = '/ ' + TOTAL_PAGES;
  pageInput.max = TOTAL_PAGES;

  // Show progress while loading first 4 pages, with 5s timeout fallback
  const firstBatch = [1, 2, 3, 4];
  let loaded = 0;

  const loadWithTimeout = (n) => Promise.race([
    loadImage(n).then(() => {
      loaded++;
      const pct = Math.round((loaded / firstBatch.length) * 100);
      loadingBar.style.width = pct + '%';
      loadingPct.textContent = pct + '%';
    }),
    sleep(5000) // 5s timeout per image — proceed anyway
  ]);

  await Promise.all(firstBatch.map(loadWithTimeout));

  // Hide loader regardless
  loadingBar.style.width = '100%';
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

  // Background preload remaining pages quietly
  backgroundPreload();
}

async function backgroundPreload() {
  for (let i = 5; i <= TOTAL_PAGES; i++) {
    await loadImage(i);
    await sleep(30);
  }
}

/* ============================================================
   DRAW IMAGE TO CANVAS
   ============================================================ */
const DPR = Math.min(window.devicePixelRatio || 1, 3);

function getLogicalSize() {
  const stageH = window.innerHeight - 56 - 52;
  const stageW = window.innerWidth;
  const bookW  = (stageW - 120) / 2;
  const bookH  = stageH - 48;
  // Use a fixed A4 ratio 595:842 = ~0.707
  const scaleH = bookH / 842;
  const scaleW = bookW / 595;
  const scale  = Math.min(scaleH, scaleW, 3.0) * zoomLevel;
  return { w: Math.round(595 * scale), h: Math.round(842 * scale) };
}

function getMobileLogicalSize() {
  const stageH = window.innerHeight - 56 - 52;
  const stageW = window.innerWidth;
  const scaleH = (stageH - 32) / 842;
  const scaleW = (stageW - 32) / 595;
  const scale  = Math.min(scaleH, scaleW) * zoomLevel;
  return { w: Math.round(595 * scale), h: Math.round(842 * scale) };
}

function drawToCanvas(canvas, img, logW, logH) {
  // Set canvas internal resolution = logical × DPR (sharp on retina)
  canvas.width  = logW * DPR;
  canvas.height = logH * DPR;
  canvas.style.width  = logW + 'px';
  canvas.style.height = logH + 'px';

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (img) {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  }
}

/* ============================================================
   SPREAD RENDERING
   ============================================================ */
function spreadToPages(spread) {
  if (spread === 0) return { left: null, right: 1 };
  const l = spread * 2;
  const r = spread * 2 + 1;
  return {
    left:  l <= TOTAL_PAGES ? l : null,
    right: r <= TOTAL_PAGES ? r : null
  };
}

function pagesToSpread(pageNum) {
  if (pageNum === 1) return 0;
  return Math.floor((pageNum - 1 + 1) / 2);
}

async function renderSpread(spread) {
  const { w, h } = getLogicalSize();
  const { left, right } = spreadToPages(spread);

  const [imgL, imgR] = await Promise.all([
    loadImage(left),
    loadImage(right)
  ]);

  drawToCanvas(canvasLeft,  imgL, w, h);
  drawToCanvas(canvasRight, imgR, w, h);

  pageLeft.style.width   = w + 'px';
  pageLeft.style.height  = h + 'px';
  pageRight.style.width  = w + 'px';
  pageRight.style.height = h + 'px';

  pageNumLeft.textContent  = left  ? left  : '';
  pageNumRight.textContent = right ? right : '';

  const firstVisible = left || right;
  pageIndicator.textContent = left && right
    ? `Pages ${left}–${right} of ${TOTAL_PAGES}`
    : `Page ${firstVisible} of ${TOTAL_PAGES}`;
  pageInput.value = firstVisible;

  updateNavButtons();

  // Preload adjacent spreads
  const { left: nl, right: nr } = spreadToPages(spread + 1);
  const { left: pl, right: pr } = spreadToPages(spread - 1);
  preloadImages([nl, nr, pl, pr].filter(Boolean));
}

/* ============================================================
   MOBILE RENDERING
   ============================================================ */
let mobilePage = 1;

async function renderMobilePage(pageNum) {
  mobilePage = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
  const { w, h } = getMobileLogicalSize();
  const img = await loadImage(mobilePage);
  drawToCanvas(canvasMobile, img, w, h);
  pageIndicator.textContent = `Page ${mobilePage} of ${TOTAL_PAGES}`;
  pageInput.value = mobilePage;
  updateNavButtons();
}

/* ============================================================
   NAVIGATION
   ============================================================ */
async function goNext() {
  if (isFlipping) return;
  if (isMobile) {
    if (mobilePage < TOTAL_PAGES) await renderMobilePage(mobilePage + 1);
    return;
  }
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
  if (isMobile) {
    if (mobilePage > 1) await renderMobilePage(mobilePage - 1);
    return;
  }
  if (currentSpread <= 0) return;
  isFlipping = true;
  await flipBackward();
  currentSpread--;
  await renderSpread(currentSpread);
  isFlipping = false;
}

async function goToPage(pageNum) {
  const p = Math.max(1, Math.min(TOTAL_PAGES, pageNum));
  if (isMobile) { await renderMobilePage(p); return; }
  currentSpread = pagesToSpread(p);
  await renderSpread(currentSpread);
}

async function goFirst() {
  currentSpread = 0; mobilePage = 1;
  if (isMobile) await renderMobilePage(1);
  else await renderSpread(0);
}

async function goLast() {
  if (isMobile) { await renderMobilePage(TOTAL_PAGES); return; }
  const maxSpread = Math.ceil((TOTAL_PAGES - 1) / 2);
  currentSpread = maxSpread;
  await renderSpread(currentSpread);
}

function updateNavButtons() {
  const maxSpread = Math.ceil((TOTAL_PAGES - 1) / 2);
  if (isMobile) {
    [prevBtn, prevBtn2, firstBtn].forEach(b => b.disabled = mobilePage <= 1);
    [nextBtn, nextBtn2, lastBtn].forEach(b => b.disabled = mobilePage >= TOTAL_PAGES);
  } else {
    [prevBtn, prevBtn2, firstBtn].forEach(b => b.disabled = currentSpread <= 0);
    [nextBtn, nextBtn2, lastBtn].forEach(b => b.disabled = currentSpread >= maxSpread);
  }
}

/* ============================================================
   FLIP ANIMATIONS
   ============================================================ */
async function flipForward() {
  const cssW = parseInt(canvasLeft.style.width)  || canvasLeft.width;
  const cssH = parseInt(canvasLeft.style.height) || canvasLeft.height;

  turningPage.style.cssText = `display:block; position:absolute; top:0; right:0; left:auto;
    width:${cssW}px; height:${cssH}px; transform:rotateY(0deg);
    transform-origin:left center; background:white;
    box-shadow:-4px 0 20px rgba(0,0,0,0.25); overflow:hidden; z-index:20;`;

  canvasTurning.width  = canvasRight.width;
  canvasTurning.height = canvasRight.height;
  canvasTurning.style.width  = cssW + 'px';
  canvasTurning.style.height = cssH + 'px';
  canvasTurning.getContext('2d').drawImage(canvasRight, 0, 0);

  await sleep(20);
  turningPage.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
  turningPage.style.transform  = 'rotateY(-180deg)';
  await sleep(440);
  turningPage.style.cssText = 'display:none;';
}

async function flipBackward() {
  const cssW = parseInt(canvasLeft.style.width)  || canvasLeft.width;
  const cssH = parseInt(canvasLeft.style.height) || canvasLeft.height;

  turningPage.style.cssText = `display:block; position:absolute; top:0; left:0; right:auto;
    width:${cssW}px; height:${cssH}px; transform:rotateY(-180deg);
    transform-origin:right center; background:white;
    box-shadow:4px 0 20px rgba(0,0,0,0.25); overflow:hidden; z-index:20;`;

  canvasTurning.width  = canvasLeft.width;
  canvasTurning.height = canvasLeft.height;
  canvasTurning.style.width  = cssW + 'px';
  canvasTurning.style.height = cssH + 'px';
  canvasTurning.getContext('2d').drawImage(canvasLeft, 0, 0);

  await sleep(20);
  turningPage.style.transition = 'transform 0.42s cubic-bezier(0.4,0,0.2,1)';
  turningPage.style.transform  = 'rotateY(0deg)';
  await sleep(440);
  turningPage.style.cssText = 'display:none;';
}

/* ============================================================
   ZOOM
   ============================================================ */
async function setZoom(level) {
  zoomLevel = Math.max(0.5, Math.min(2.0, level));
  zoomLabel.textContent = Math.round(zoomLevel * 100) + '%';
  if (isMobile) await renderMobilePage(mobilePage);
  else await renderSpread(currentSpread);
}

/* ============================================================
   DOWNLOAD
   ============================================================ */
downloadBtn.addEventListener('click', () => {
  const a = document.createElement('a');
  a.href = './assets/MBA6643-SIM-FINAL.pdf';
  a.download = 'MBA6643-SIM-FINAL.pdf';
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
});

fullscreenBtn.addEventListener('click', () => {
  window.open(window.location.href, '_blank', 'noopener,noreferrer');
});

/* ============================================================
   EVENT LISTENERS
   ============================================================ */
prevBtn.addEventListener('click',  goPrev);
nextBtn.addEventListener('click',  goNext);
prevBtn2.addEventListener('click', goPrev);
nextBtn2.addEventListener('click', goNext);
firstBtn.addEventListener('click', goFirst);
lastBtn.addEventListener('click',  goLast);
zoomInBtn.addEventListener('click',  () => setZoom(zoomLevel + 0.2));
zoomOutBtn.addEventListener('click', () => setZoom(zoomLevel - 0.2));

pageInput.addEventListener('change', () => {
  const v = parseInt(pageInput.value, 10);
  if (!isNaN(v)) goToPage(v);
});
pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { const v = parseInt(pageInput.value,10); if(!isNaN(v)) goToPage(v); }
});

document.addEventListener('keydown', (e) => {
  if (e.target === pageInput) return;
  if (['ArrowRight','ArrowDown','PageDown'].includes(e.key)) { e.preventDefault(); goNext(); }
  else if (['ArrowLeft','ArrowUp','PageUp'].includes(e.key)) { e.preventDefault(); goPrev(); }
  else if (e.key === 'Home') { e.preventDefault(); goFirst(); }
  else if (e.key === 'End')  { e.preventDefault(); goLast(); }
  else if (e.key === '+' || e.key === '=') setZoom(zoomLevel + 0.2);
  else if (e.key === '-') setZoom(zoomLevel - 0.2);
});

let touchStartX = 0;
document.addEventListener('touchstart', e => { touchStartX = e.touches[0].clientX; }, {passive:true});
document.addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 50) { dx < 0 ? goNext() : goPrev(); }
}, {passive:true});

let wheelTimeout;
document.addEventListener('wheel', e => {
  clearTimeout(wheelTimeout);
  wheelTimeout = setTimeout(() => { e.deltaY > 0 ? goNext() : goPrev(); }, 80);
}, {passive:true});

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(async () => {
    const wasM = isMobile;
    isMobile = window.innerWidth <= 640;
    if (isMobile !== wasM) {
      if (isMobile) {
        flipbookContainer.style.display = 'none';
        mobileViewer.style.display = '';
        await renderMobilePage(1);
      } else {
        mobileViewer.style.display = 'none';
        flipbookContainer.style.display = '';
        await renderSpread(currentSpread);
      }
    } else {
      isMobile ? renderMobilePage(mobilePage) : renderSpread(currentSpread);
    }
  }, 200);
});

/* ============================================================
   HELPERS
   ============================================================ */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ============================================================
   INIT
   ============================================================ */
init();
