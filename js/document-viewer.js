const params = new URLSearchParams(window.location.search);
const sourceUrl = params.get('src') || '';
const fileName = params.get('name') || 'Document';
const host = document.getElementById('viewerScroll');
const nameEl = document.getElementById('viewerName');
const pageInfo = document.getElementById('pageInfo');
const zoomValue = document.getElementById('zoomValue');
let pdfDoc = null;
let zoom = 1;
let renderToken = 0;

nameEl.textContent = fileName;
document.title = fileName + ' - Redmyre House';
document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.getElementById('printBtn').addEventListener('click', () => window.print());
document.getElementById('downloadBtn').addEventListener('click', downloadOriginal);
document.getElementById('zoomOut').addEventListener('click', () => changeZoom(-0.1));
document.getElementById('zoomIn').addEventListener('click', () => changeZoom(0.1));

async function downloadOriginal() {
  try {
    const response = await fetch(sourceUrl);
    if (!response.ok) throw new Error('Download failed');
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  } catch (err) {
    console.error(err);
    showMessage('Download failed. Use the browser menu to save the file.', true);
  }
}

function showMessage(message, isError = false) {
  host.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'viewer-message' + (isError ? ' error' : '');
  el.textContent = message;
  host.appendChild(el);
}

async function init() {
  if (!sourceUrl) { showMessage('No document was provided.', true); return; }
  if (!fileName.toLowerCase().endsWith('.pdf')) {
    host.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = sourceUrl;
    frame.style.cssText = 'width:100%;height:100%;border:0;background:#fff';
    host.appendChild(frame);
    pageInfo.textContent = 'Document';
    zoomValue.textContent = '—';
    return;
  }
  try {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    pdfDoc = await pdfjs.getDocument({ url: sourceUrl, withCredentials: false }).promise;
    pageInfo.textContent = pdfDoc.numPages + ' pages';
    await renderPages();
  } catch (err) {
    console.error('Document viewer error:', err);
    showMessage('The PDF could not be loaded. Please download the original file.', true);
  }
}

async function renderPages() {
  const token = String(++renderToken);
  host.innerHTML = '';
  host.classList.add('pdfjs-pages');
  for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber++) {
    if (token !== String(renderToken)) return;
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: zoom });
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = viewport.width + 'px';
    canvas.style.height = viewport.height + 'px';
    const wrap = document.createElement('div');
    wrap.className = 'pdfjs-page';
    wrap.appendChild(canvas);
    host.appendChild(wrap);
    await page.render({ canvasContext: ctx, viewport, transform: ratio === 1 ? null : [ratio,0,0,ratio,0,0] }).promise;
  }
}
function changeZoom(delta) {
  if (!pdfDoc) return;
  zoom = Math.max(0.6, Math.min(2.0, +(zoom + delta).toFixed(1)));
  zoomValue.textContent = Math.round(zoom * 100) + '%';
  renderPages().catch(err => console.error(err));
}
init();
