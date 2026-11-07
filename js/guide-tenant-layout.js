
import { initLayout } from '/js/layout.js';
const ctx = await initLayout();
if (!ctx) throw new Error('Layout init failed');
document.getElementById('sidebarPlaceholder')?.setAttribute('translate','no');
document.getElementById('topbarPlaceholder')?.setAttribute('translate','no');
document.getElementById('sidebarPlaceholder')?.classList.add('notranslate');
document.getElementById('topbarPlaceholder')?.classList.add('notranslate');
