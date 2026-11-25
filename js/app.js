import { CATEGORIES, ROOMS, STATUSES, DEFAULT_STATUS } from './constants.js';
import {
  vaultExists,
  createVault,
  unlock,
  lock,
  isUnlocked,
  encryptJSON,
  decryptJSON,
  encryptBytes,
  decryptBytes,
  exportVaultMeta,
  importVaultMeta
} from './crypto.js';
import {
  getAllRecords,
  putRecord,
  deleteRecord,
  deleteRecords,
  clearAll,
  putMeta,
  deleteMeta
} from './db.js';
import { classifyPhoto, aiAvailable } from './ai.js';
import { estimateValue, estimateExplanation } from './estimate.js';
import { createPlanView, defaultPlan, zoneLabels } from './plan.js';

const LOCK_INACTIVITY_MS = 5 * 60 * 1000;

const state = {
  items: new Map(),
  fileRecords: new Map(),
  fileUrls: new Map(),
  plan: null,
  planCtl: null,
  filters: { q: '', category: '', room: '', year: '', status: 'actif', group: 'room', sort: 'name' },
  editing: null
};

const $ = (id) => document.getElementById(id);
const el = {
  lockScreen: $('lock-screen'),
  lockTitle: $('lock-title'),
  lockPassword: $('lock-password'),
  lockPasswordConfirm: $('lock-password-confirm'),
  lockError: $('lock-error'),
  btnUnlock: $('btn-unlock'),
  app: $('app'),
  headerTotal: $('header-total'),
  listContainer: $('list-container'),
  photoList: $('photo-list'),
  invoiceList: $('invoice-list'),
  aiStatus: $('ai-status'),
  estimateHint: $('estimate-hint'),
  btnDelete: $('btn-delete'),
  toast: $('toast')
};

let lockMode = 'unlock';
let lockTimer = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtCurrency(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(value);
}

function fmtDate(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-FR');
}

function toast(message) {
  el.toast.textContent = message;
  el.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.toast.hidden = true; }, 2600);
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      navigator.serviceWorker.register('./sw.js');
    } catch (error) {
      console.warn('Service worker indisponible :', error);
    }
  }
}

function resetLockTimer() {
  clearTimeout(lockTimer);
  if (isUnlocked()) {
    lockTimer = setTimeout(lockNow, LOCK_INACTIVITY_MS);
  }
}

function lockNow() {
  clearTimeout(lockTimer);
  revokeUrls();
  lock();
  state.items = new Map();
  state.fileRecords = new Map();
  state.editing = null;
  el.app.hidden = true;
  el.lockScreen.hidden = false;
  el.lockTitle.textContent = 'Session verrouillée automatiquement';
  el.lockPassword.value = '';
  el.lockPassword.focus();
}

function revokeUrls() {
  for (const url of state.fileUrls.values()) URL.revokeObjectURL(url);
  state.fileUrls.clear();
}

async function loadAll() {
  const records = await getAllRecords();
  state.items = new Map();
  state.fileRecords = new Map();
  for (const record of records) {
    if (record.type === 'item') {
      try {
        const item = await decryptJSON(record);
        state.items.set(item.id, item);
      } catch (error) {
        console.warn('Enregistrement illisible ignoré :', record.id);
      }
    } else if (record.type === 'file') {
      state.fileRecords.set(record.id, record);
    } else if (record.type === 'plan') {
      try {
        state.plan = (await decryptJSON(record)).value || null;
      } catch (error) {
        console.warn('Plan illisible ignoré :', record.id);
      }
    }
  }
  if (!state.plan) state.plan = defaultPlan();
}

function roomLabels() {
  const plan = state.plan || defaultPlan();
  return [...new Set([...ROOMS, ...zoneLabels(plan)])];
}

function refreshFormRoomSelect() {
  const labels = roomLabels();
  const select = $('i-room');
  const previous = select.value;
  select.innerHTML = labels.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  if (previous && labels.includes(previous)) select.value = previous;
}

async function savePlan() {
  try {
    const record = { id: 'plan:main', type: 'plan', ...(await encryptJSON({ value: state.plan })) };
    await putRecord(record);
  } catch (error) {
    toast(`Échec de l'enregistrement du plan : ${error.message}`);
  }
}

function viewZoneItems(label) {
  state.filters.room = label;
  $('f-room').value = label;
  switchView('list');
  renderList();
}

function yearsList() {
  const years = new Set();
  for (const item of state.items.values()) {
    if (item.purchaseDate) years.add(item.purchaseDate.slice(0, 4));
  }
  return [...years].sort((a, b) => b.localeCompare(a));
}

function refreshFilters() {
  const category = $('f-category');
  const room = $('f-room');
  const year = $('f-year');
  const keep = (select, current) => {
    select.value = [...select.options].some((o) => o.value === current) ? current : '';
  };
  $('f-category').innerHTML =
    '<option value="">Toutes catégories</option>' +
    CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('f-room').innerHTML =
    '<option value="">Toutes pièces</option>' +
    roomLabels().map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  year.innerHTML = '<option value="">Toutes années</option>' + yearsList().map((y) => `<option value="${y}">${y}</option>`).join('');
  keep(category, state.filters.category);
  keep(room, state.filters.room);
  keep(year, state.filters.year);
}

function filteredItems() {
  const f = state.filters;
  const q = f.q.trim().toLowerCase();
  let list = [...state.items.values()].filter((item) => {
    if (f.status && (item.status || 'actif') !== f.status) return false;
    if (f.category && item.category !== f.category) return false;
    if (f.room && item.room !== f.room) return false;
    if (f.year && item.purchaseDate && item.purchaseDate.slice(0, 4) !== f.year) return false;
    if (q) {
      const haystack = [item.name, item.category, item.room, item.notes].join(' ').toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });
  const by = {
    name: (a, b) => (a.name || '').localeCompare(b.name || '', 'fr'),
    estimated: (a, b) => effectiveValue(b) - effectiveValue(a),
    price: (a, b) => (b.price || 0) - (a.price || 0),
    date: (a, b) => (b.purchaseDate || '').localeCompare(a.purchaseDate || '')
  };
  list.sort(by[f.sort] || by.name);
  return list;
}

function effectiveValue(item) {
  if (typeof item.estimated === 'number') return item.estimated;
  if (typeof item.price === 'number') return item.price;
  return 0;
}

function itemYear(item) {
  return item.purchaseDate ? item.purchaseDate.slice(0, 4) : '';
}

function fileUrl(fileId) {
  if (state.fileUrls.has(fileId)) return state.fileUrls.get(fileId);
  return null;
}

async function ensureFileUrl(fileId) {
  if (state.fileUrls.has(fileId)) return state.fileUrls.get(fileId);
  const record = state.fileRecords.get(fileId);
  if (!record) return null;
  try {
    const buffer = await decryptBytes(record);
    const url = URL.createObjectURL(new Blob([buffer], { type: record.mime || 'application/octet-stream' }));
    state.fileUrls.set(fileId, url);
    return url;
  } catch (error) {
    return null;
  }
}

async function renderList() {
  const items = filteredItems();
  if (state.items.size === 0) {
    el.listContainer.innerHTML = `
      <div class="empty">
        <p style="font-size:2rem;margin:0">📦</p>
        <strong>Votre inventaire est vide</strong>
        <p>Cliquez sur « ＋ Ajouter un bien », prenez une photo de votre premier objet :<br>
        l'IA proposera automatiquement une catégorie et un nom. Ajoutez le prix d'achat,
        l'app calcule une valeur estimée.</p>
      </div>`;
    return;
  }
  if (items.length === 0) {
    el.listContainer.innerHTML = '<div class="empty">Aucun résultat pour ces filtres. Élargissez la recherche ou changez de statut.</div>';
    return;
  }

  const group = state.filters.group;
  let html = '';
  if (group === 'none') {
    html = await itemsHtml(items);
  } else {
    const groups = new Map();
    if (group === 'room') {
      for (const r of ROOMS) groups.set(r, []);
    }
    if (group === 'category') {
      for (const c of CATEGORIES) groups.set(c, []);
    }
    for (const item of items) {
      const key = group === 'room' ? (item.room || 'Sans pièce')
        : group === 'category' ? (item.category || 'Autre')
        : (itemYear(item) || 'Sans date');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }
    const ordered = [...groups.entries()];
    if (group === 'year') {
      ordered.sort((a, b) => b[0].localeCompare(a[0], 'fr', { numeric: true }));
    }
    for (const [label, groupItems] of ordered) {
      if (groupItems.length === 0) continue;
      const total = groupItems.reduce((sum, item) => sum + effectiveValue(item), 0);
      html += `<h3 class="group-title">${escapeHtml(label)} — ${groupItems.length} objet(s) · ${fmtCurrency(total)}</h3>`;
      html += await itemsHtml(groupItems);
    }
  }
  el.listContainer.innerHTML = html;
}

async function itemsHtml(items) {
  const parts = [];
  for (const item of items) {
    parts.push(itemRowHtml(item));
  }
  if (parts.length === 0) return '';
  const rows = parts.join('');
  const container = document.createElement('div');
  container.innerHTML = rows;
  for (const img of container.querySelectorAll('img[data-file]')) {
    const url = await ensureFileUrl(img.dataset.file);
    if (url) img.src = url;
  }
  const fragment = container.innerHTML;
  container.remove();
  return fragment;
}

function itemRowHtml(item) {
  const photoId = item.photos && item.photos[0] ? item.photos[0].id : null;
  const thumb = photoId
    ? `<img class="thumb" data-file="${escapeHtml(photoId)}" alt="">`
    : '<div class="thumb" aria-hidden="true">📷</div>';
  const statusBadge = (item.status && item.status !== 'actif')
    ? `<span class="badge warn">${escapeHtml(statusLabel(item.status))}</span>` : '';
  const invoiceCount = (item.invoices || []).length;
  return `
    <article class="item-row" data-id="${escapeHtml(item.id)}" role="button" tabindex="0">
      ${thumb}
      <div class="row-main">
        <div class="row-name">${escapeHtml(item.name || 'Sans nom')} ${statusBadge}</div>
        <div class="row-meta">
          <span class="badge">${escapeHtml(item.category || 'Autre')}</span>
          ${escapeHtml(item.room || '—')} · ${itemYear(item) || 'date ?'}
          · ${item.photos ? item.photos.length : 0} photo(s) · ${invoiceCount} facture(s)
        </div>
      </div>
      <div class="row-amount">
        <strong>${fmtCurrency(effectiveValue(item) || null)}</strong>
        <small>achat ${fmtCurrency(item.price ?? null)}</small>
      </div>
    </article>`;
}

function statusLabel(value) {
  const found = STATUSES.find((s) => s.value === value);
  return found ? found.label.split(' (')[0] : value;
}

function updateHeaderTotal() {
  const active = [...state.items.values()].filter((item) => (item.status || 'actif') === 'actif');
  const total = active.reduce((sum, item) => sum + effectiveValue(item), 0);
  el.headerTotal.textContent = `${active.length} bien(s) actif(s) · ${fmtCurrency(total)}`;
}

function renderStats() {
  const active = [...state.items.values()].filter((item) => (item.status || 'actif') === 'actif');
  const totalEstimate = active.reduce((sum, item) => sum + effectiveValue(item), 0);
  const totalPurchase = active.reduce((sum, item) => sum + (item.price || 0), 0);
  const withPhotos = active.filter((item) => (item.photos || []).length > 0).length;
  const withInvoices = active.filter((item) => (item.invoices || []).length > 0).length;
  $('stat-cards').innerHTML = `
    <div class="card"><small>Biens actifs</small><strong>${active.length}</strong></div>
    <div class="card"><small>Valeur estimée totale</small><strong>${fmtCurrency(totalEstimate)}</strong></div>
    <div class="card"><small>Total prix d'achat</small><strong>${fmtCurrency(totalPurchase)}</strong></div>
    <div class="card"><small>Biens avec facture</small><strong>${withInvoices}/${active.length}</strong></div>
    <div class="card"><small>Biens avec photo</small><strong>${withPhotos}/${active.length}</strong></div>`;

  $('stat-breakdowns').innerHTML = [
    breakdownHtml('Par pièce', active, (item) => item.room || 'Sans pièce', ROOMS),
    breakdownHtml('Par catégorie', active, (item) => item.category || 'Autre', CATEGORIES),
    breakdownHtml('Par année d\'achat', active, itemYear, null)
  ].join('');
}

function breakdownHtml(title, items, keyFn, order) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item) || '—';
    if (!map.has(key)) map.set(key, { count: 0, value: 0 });
    map.get(key).count += 1;
    map.get(key).value += effectiveValue(item);
  }
  let entries = [...map.entries()];
  if (order) {
    const rank = new Map(order.map((k, i) => [k, i]));
    entries.sort((a, b) => (rank.get(a[0]) ?? 999) - (rank.get(b[0]) ?? 999));
  } else {
    entries.sort((a, b) => b[0].localeCompare(a[0], 'fr', { numeric: true }));
  }
  const max = Math.max(1, ...entries.map(([, v]) => v.value));
  const rows = entries.map(([label, v]) => `
    <div class="bar-row">
      <span>${escapeHtml(label)} <span class="muted">(${v.count})</span></span>
      <span class="bar-track"><span class="bar" style="width:${Math.round((v.value / max) * 100)}%"></span></span>
      <span class="bar-amount">${fmtCurrency(v.value)}</span>
    </div>`).join('');
  return `<div class="breakdown"><h3>${escapeHtml(title)}</h3>${rows || '<p class="hint">Aucune donnée.</p>'}</div>`;
}

function switchView(name) {
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === name));
  for (const view of document.querySelectorAll('.view')) view.hidden = view.id !== `view-${name}`;
  if (name === 'stats') renderStats();
  if (name === 'list') renderList();
}

function openForm(itemId) {
  const item = itemId ? state.items.get(itemId) : null;
  state.editing = {
    existing: item || null,
    photos: item ? [...(item.photos || [])] : [],
    invoices: item ? [...(item.invoices || [])] : [],
    addedPhotos: [],
    addedInvoices: []
  };
  $('i-id').value = item ? item.id : '';
  $('i-name').value = item ? item.name || '' : '';
  $('i-category').value = item && CATEGORIES.includes(item.category) ? item.category : 'Autre';
  $('i-room').value = item && ROOMS.includes(item.room) ? item.room : 'Autre';
  $('i-date').value = item ? item.purchaseDate || '' : '';
  $('i-price').value = item && typeof item.price === 'number' ? item.price : '';
  $('i-estimated').value = item && typeof item.estimated === 'number' ? item.estimated : '';
  $('i-status').value = item ? item.status || 'actif' : DEFAULT_STATUS;
  $('i-notes').value = item ? item.notes || '' : '';
  $('i-photos').value = '';
  $('i-invoices').value = '';
  $('ai-status').textContent = '';
  updateEstimateHint();
  el.btnDelete.hidden = !item;
  el.photoList.innerHTML = '';
  el.invoiceList.innerHTML = '';
  renderAttachments();
  switchView('form');
  if (!item) $('i-name').focus();
}

function chipHtml(entry, listKind) {
  const isPhoto = listKind === 'photo';
  let preview;
  if (entry.url) {
    preview = `<img src="${entry.url}" alt="">`;
  } else {
    preview = `<img data-file="${escapeHtml(entry.id)}" alt="">`;
  }
  if (!isPhoto && !entry.isImage) {
    preview = '<span aria-hidden="true">📄</span>';
  }
  return `
    <span class="chip">
      ${preview}
      <span>${escapeHtml(entry.label || 'fichier')}</span>
      <button type="button" data-remove="${escapeHtml(entry.key)}" data-kind="${listKind}" aria-label="Retirer">×</button>
    </span>`;
}

async function renderAttachments() {
  if (!state.editing) return;
  const photoHtml = [];
  for (const entry of state.editing.photos) {
    const url = await ensureFileUrl(entry.id);
    photoHtml.push(chipHtml({ ...entry, url, key: entry.id }, 'photo'));
  }
  for (const added of state.editing.addedPhotos) {
    photoHtml.push(chipHtml({ ...added, url: added.url }, 'photo'));
  }
  const invoiceHtml = [];
  for (const entry of state.editing.invoices) {
    const url = await ensureFileUrl(entry.id);
    invoiceHtml.push(chipHtml({ ...entry, url, key: entry.id, isImage: (state.fileRecords.get(entry.id)?.mime || '').startsWith('image/') }, 'invoice'));
  }
  for (const added of state.editing.addedInvoices) {
    invoiceHtml.push(chipHtml({ ...added, url: added.isImage ? added.url : null, key: added.key }, 'invoice'));
  }
  el.photoList.innerHTML = photoHtml.join('');
  el.invoiceList.innerHTML = invoiceHtml.join('');
  for (const img of document.querySelectorAll('#photo-list img[data-file], #invoice-list img[data-file]')) {
    await ensureFileUrl(img.dataset.file);
    const url = fileUrl(img.dataset.file);
    if (url) img.src = url;
  }
}

async function handleFiles(kind, files) {
  if (!state.editing) return;
  const list = kind === 'photo' ? state.editing.addedPhotos : state.editing.addedInvoices;
  for (const file of files) {
    const isImage = file.type.startsWith('image/');
    const entry = {
      key: `new:${globalThis.crypto.randomUUID()}`,
      id: null,
      blob: file,
      label: file.name,
      mime: file.type,
      isImage,
      url: isImage ? URL.createObjectURL(file) : null
    };
    list.push(entry);
  }
  await renderAttachments();
  if (kind === 'photo') {
    void runClassification(files[files.length - 1]);
  }
}

function randomId() {
  return globalThis.crypto.randomUUID();
}

async function runClassification(file) {
  if (!file) return;
  el.aiStatus.textContent = '🧠 Analyse de la photo…';
  if (!aiAvailable()) {
    el.aiStatus.textContent = 'IA indisponible (hors ligne) — choisissez manuellement la catégorie.';
    return;
  }
  try {
    const result = await classifyPhoto(file);
    $('i-category').value = result.category;
    if (!$('i-name').value.trim() && result.suggestion) {
      $('i-name').value = result.suggestion;
    }
    el.aiStatus.textContent = `🧠 Suggestion IA : catégorie « ${result.category} », nom « ${result.suggestion} » (confiance ${Math.round(result.confidence * 100)} %). Modifiez librement.`;
  } catch (error) {
    el.aiStatus.textContent = 'IA indisponible — choisissez manuellement la catégorie.';
  }
}

function collectItem() {
  const name = $('i-name').value.trim();
  if (!name) {
    toast('Le nom du bien est obligatoire.');
    $('i-name').focus();
    return null;
  }
  const now = new Date().toISOString();
  const existing = state.editing.existing;
  const parse = (value) => {
    if (value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const photoEntries = [];
  const invoiceEntries = [];
  state.editing.photos.forEach((entry) => photoEntries.push({ id: entry.id, label: entry.label }));
  state.editing.invoices.forEach((entry) => invoiceEntries.push({ id: entry.id, label: entry.label }));
  state.editing.addedPhotos.forEach((entry) => photoEntries.push({ id: entry.newId, label: entry.label, _pending: entry }));
  state.editing.addedInvoices.forEach((entry) => invoiceEntries.push({ id: entry.newId, label: entry.label, _pending: entry }));
  return {
    id: existing ? existing.id : `item:${randomId()}`,
    name,
    category: $('i-category').value,
    room: $('i-room').value,
    purchaseDate: $('i-date').value || null,
    price: parse($('i-price').value),
    estimated: parse($('i-estimated').value),
    status: $('i-status').value,
    notes: $('i-notes').value.trim() || null,
    photos: photoEntries,
    invoices: invoiceEntries,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };
}

async function saveItem() {
  const draft = collectItem();
  if (!draft) return;
  state.editing.addedPhotos.forEach((entry) => { entry.newId = `file:${randomId()}`; });
  state.editing.addedInvoices.forEach((entry) => { entry.newId = `file:${randomId()}`; });
  const finalDraft = collectItem();
  if (!finalDraft) return;
  try {
    for (const entry of [...state.editing.addedPhotos, ...state.editing.addedInvoices]) {
      const record = await encryptStoredFile(entry);
      await putRecord(record);
      state.fileRecords.set(record.id, record);
    }
    const removed = [];
    const original = state.editing.existing;
    if (original) {
      const keep = new Set([...finalDraft.photos, ...finalDraft.invoices].map((p) => p.id).filter(Boolean));
      const all = [...(original.photos || []), ...(original.invoices || [])];
      for (const entry of all) {
        if (entry && entry.id && !keep.has(entry.id)) removed.push(entry.id);
      }
    }
    if (removed.length > 0) {
      await deleteRecords(removed);
      removed.forEach((id) => {
        state.fileRecords.delete(id);
        const url = state.fileUrls.get(id);
        if (url) URL.revokeObjectURL(url);
        state.fileUrls.delete(id);
      });
    }
    const record = { id: finalDraft.id, type: 'item', ...(await encryptJSON(finalDraft)) };
    await putRecord(record);
    state.items.set(finalDraft.id, finalDraft);
    toast('Enregistré ✓');
    state.editing = null;
    refreshFilters();
    updateHeaderTotal();
    switchView('list');
    await renderList();
  } catch (error) {
    toast(`Échec de l'enregistrement : ${error.message}`);
  }
}

async function encryptStoredFile(entry) {
  const buffer = await entry.blob.arrayBuffer();
  const payload = await encryptBytes(buffer);
  return { id: entry.newId, type: 'file', mime: entry.mime || 'application/octet-stream', ...payload };
}

function updateEstimateHint() {
  const draft = {
    category: $('i-category').value,
    purchaseDate: $('i-date').value,
    price: $('i-price').value === '' ? null : Number($('i-price').value),
    createdAt: state.editing && state.editing.existing ? state.editing.existing.createdAt : new Date().toISOString()
  };
  const value = estimateValue(draft);
  el.estimateHint.textContent = estimateExplanation(draft, value);
}

async function deleteCurrentItem() {
  const existing = state.editing && state.editing.existing;
  if (!existing) return;
  if (!confirm(`Supprimer « ${existing.name} » et ses fichiers liés ?`)) return;
  try {
    const fileIds = [...(existing.photos || []), ...(existing.invoices || [])].map((p) => p.id).filter(Boolean);
    await deleteRecords(fileIds);
    fileIds.forEach((id) => {
      state.fileRecords.delete(id);
      const url = state.fileUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      state.fileUrls.delete(id);
    });
    await deleteRecord(existing.id);
    state.items.delete(existing.id);
    toast('Bien supprimé.');
    state.editing = null;
    updateHeaderTotal();
    refreshFilters();
    switchView('list');
    await renderList();
  } catch (error) {
    toast(`Échec de la suppression : ${error.message}`);
  }
}

async function backup() {
  const records = await getAllRecords();
  const vault = await exportVaultMeta();
  const payload = {
    app: 'inventaire-biens',
    version: 1,
    exportedAt: new Date().toISOString(),
    vault,
    records
  };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const stamp = new Date().toISOString().slice(0, 10);
  const status = $('backup-status');
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: `inventaire-biens-${stamp}.json`,
        types: [{ description: 'Sauvegarde chiffrée', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      status.textContent = `Sauvegarde enregistrée (${records.length} enregistrements). Pensez à la refaire régulièrement.`;
    } else {
      await downloadBlob(blob, `inventaire-biens-${stamp}.json`);
      status.textContent = 'Sauvegarde téléchargée. Déplacez-la (partagez le fichier) vers iCloud Drive.';
    }
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    status.textContent = `Échec de la sauvegarde : ${error.message}`;
  }
}

async function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function restore(file) {
  let payload;
  try {
    payload = JSON.parse(await file.text());
  } catch (error) {
    $('backup-status').textContent = 'Fichier illisible : ce n\'est pas une sauvegarde valide.';
    return;
  }
  if (!payload || payload.app !== 'inventaire-biens' || !Array.isArray(payload.records) || !payload.vault) {
    $('backup-status').textContent = 'Fichier illisible : ce n\'est pas une sauvegarde valide.';
    return;
  }
  const ok = confirm(
    `Restaurer cette sauvegarde du ${fmtDate(payload.exportedAt)} ?\n\n` +
    'Cette opération remplace TOUTES les données actuelles de cet appareil.\n' +
    'Après restauration, le mot de passe maître sera celui utilisé lors de la sauvegarde.\n' +
    'Continuez seulement si vous connaissez ce mot de passe.'
  );
  if (!ok) return;
  try {
    await clearAll();
    await importVaultMeta(payload.vault);
    for (const record of payload.records) {
      await putRecord(record);
    }
    toast('Restauration terminée. Rechargement…');
    setTimeout(() => window.location.reload(), 800);
  } catch (error) {
    $('backup-status').textContent = `Échec de la restauration : ${error.message}`;
  }
}

async function buildReport() {
  const activeOnly = $('rep-active-only').checked;
  const items = [...state.items.values()]
    .filter((item) => (activeOnly ? (item.status || 'actif') === 'actif' : true))
    .sort((a, b) => (a.room || '').localeCompare(b.room || '', 'fr'));
  if (items.length === 0) {
    toast('Aucun bien à inclure dans le rapport.');
    return;
  }
  const printArea = $('print-area');
  printArea.innerHTML = '<p>Préparation du dossier…</p>';
  const cards = await Promise.all(items.map(async (item) => reportItemHtml(item)));
  const total = items.reduce((sum, item) => sum + effectiveValue(item), 0);
  printArea.innerHTML = `
    <div class="r-report-header">
      <h1>Dossier d'inventaire — déclaration de sinistre</h1>
      <p>Édité le ${fmtDate(new Date().toISOString())} · ${items.length} biens · Valeur totale estimée : ${fmtCurrency(total)}</p>
    </div>
    ${cards.join('')}
    <div class="r-totals">Valeur totale estimée : ${fmtCurrency(total)}</div>`;
  window.print();
}

async function reportItemHtml(item) {
  const photoId = item.photos && item.photos[0] ? item.photos[0].id : null;
  let photoHtml = '<em>aucune photo</em>';
  if (photoId) {
    const url = await ensureFileUrl(photoId);
    if (url) photoHtml = `<img src="${url}" alt="">`;
  }
  const invoices = item.invoices || [];
  return `
    <div class="r-item">
      <div class="r-photo">${photoHtml}</div>
      <div class="r-info">
        <h3>${escapeHtml(item.name || 'Sans nom')}</h3>
        <table>
          <tr><td>Catégorie / pièce</td><td>${escapeHtml(item.category || '—')} · ${escapeHtml(item.room || '—')}</td></tr>
          <tr><td>Date d'achat</td><td>${fmtDate(item.purchaseDate)}</td></tr>
          <tr><td>Prix d'achat</td><td>${fmtCurrency(item.price ?? null)}</td></tr>
          <tr><td>Valeur estimée</td><td><strong>${fmtCurrency(effectiveValue(item) || null)}</strong></td></tr>
          <tr><td>Statut</td><td>${escapeHtml(statusLabel(item.status || 'actif'))}</td></tr>
          <tr><td>Factures liées</td><td>${invoices.length} document(s)${invoices.length ? ` — ${escapeHtml(invoices.map((i) => i.label).join(', '))}` : ''}</td></tr>
          <tr><td>Notes</td><td>${escapeHtml(item.notes || '—')}</td></tr>
        </table>
      </div>
    </div>`;
}

async function wipeAll() {
  if (!confirm('Effacer DÉFINITIVEMENT toutes les données locales (inventaire + fichiers) ?\nPensez à faire une sauvegarde avant.')) return;
  if (!confirm('Confirmez une seconde fois : Cette action est irréversible.')) return;
  await clearAll();
  await deleteMeta('vault');
  toast('Données effacées. Rechargement…');
  setTimeout(() => window.location.reload(), 800);
}

async function onUnlockClick() {
  el.lockError.hidden = true;
  const password = el.lockPassword.value;
  try {
    if (lockMode === 'create') {
      const confirmValue = el.lockPasswordConfirm.value;
      if (password !== confirmValue) {
        throw new Error('Les deux mots de passe ne correspondent pas.');
      }
      await createVault(password);
    } else {
      await unlock(password);
    }
    el.lockPassword.value = '';
    el.lockPasswordConfirm.value = '';
    enterApp();
  } catch (error) {
    el.lockError.textContent = error.message;
    el.lockError.hidden = false;
  }
}

function enterApp() {
  el.lockScreen.hidden = true;
  el.app.hidden = false;
  lockMode = 'unlock';
  el.lockTitle.textContent = 'Déverrouillez votre coffre';
  el.lockPasswordConfirm.hidden = true;
  loadAll()
    .then(() => {
      state.planCtl.setPlan(state.plan);
      refreshFilters();
      updateHeaderTotal();
      switchView('list');
      resetLockTimer();
    })
    .catch((error) => toast(`Erreur de lecture du coffre : ${error.message}`));
}

async function init() {
  registerServiceWorker();

  $('i-category').innerHTML = CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('i-room').innerHTML = ROOMS.map((r) => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join('');
  $('i-status').innerHTML = STATUSES.map((s) => `<option value="${escapeHtml(s.value)}">${escapeHtml(s.label)}</option>`).join('');

  state.planCtl = createPlanView($('view-plan'), {
    onChange: (plan) => {
      state.plan = plan;
      void savePlan();
      refreshFilters();
      refreshFormRoomSelect();
    },
    onViewZone: viewZoneItems
  });
  $('about-text').textContent =
    'Les données sont stockées uniquement dans ce navigateur (IndexedDB), chiffrées en AES-256-GCM avec une clé dérivée de votre mot de passe maître (PBKDF2, 310 000 itérations).';

  const hasVault = await vaultExists();
  const passwordConfirmState = (visible) => { el.lockPasswordConfirm.hidden = !visible; };
  if (hasVault) {
    lockMode = 'unlock';
    el.lockTitle.textContent = 'Déverrouillez votre coffre';
    passwordConfirmState(false);
  } else {
    lockMode = 'create';
    el.lockTitle.textContent = 'Créez votre coffre : choisissez un mot de passe maître';
    passwordConfirmState(true);
  }

  el.lockPasswordConfirm.hidden = lockMode !== 'create';

  el.btnUnlock.addEventListener('click', onUnlockClick);
  el.lockPassword.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onUnlockClick();
  });
  el.lockPasswordConfirm.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onUnlockClick();
  });
  el.lockPassword.focus();

  $('btn-lock').addEventListener('click', lockNow);
  $('btn-add').addEventListener('click', () => openForm(null));

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.dataset.view));
  });

  const onFilter = () => {
    state.filters = {
      q: $('f-search').value,
      category: $('f-category').value,
      room: $('f-room').value,
      year: $('f-year').value,
      status: $('f-status').value,
      group: $('f-group').value,
      sort: $('f-sort').value
    };
    renderList();
  };
  ['f-search', 'f-category', 'f-room', 'f-year', 'f-status', 'f-group', 'f-sort'].forEach((id) => {
    const input = $(id);
    input.addEventListener('input', onFilter);
    input.addEventListener('change', onFilter);
  });

  el.listContainer.addEventListener('click', (event) => {
    const row = event.target.closest('.item-row');
    if (row) openForm(row.dataset.id);
  });
  el.listContainer.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const row = event.target.closest('.item-row');
    if (row) {
      event.preventDefault();
      openForm(row.dataset.id);
    }
  });

  el.photoList.addEventListener('click', removeChip);
  el.invoiceList.addEventListener('click', removeChip);
  $('i-photos').addEventListener('change', (event) => {
    void handleFiles('photo', [...event.target.files]);
  });
  $('i-invoices').addEventListener('change', (event) => {
    void handleFiles('invoice', [...event.target.files]);
  });
  $('i-category').addEventListener('change', updateEstimateHint);
  $('i-date').addEventListener('change', updateEstimateHint);
  $('i-price').addEventListener('input', updateEstimateHint);
  $('btn-estimate').addEventListener('click', () => {
    const draft = {
      category: $('i-category').value,
      purchaseDate: $('i-date').value,
      price: $('i-price').value === '' ? null : Number($('i-price').value),
      createdAt: state.editing && state.editing.existing ? state.editing.existing.createdAt : new Date().toISOString()
    };
    const value = estimateValue(draft);
    if (value !== null) {
      $('i-estimated').value = value;
      el.estimateHint.textContent = `Valeur proposée : ${fmtCurrency(value)} — ${estimateExplanation(draft, value)} Ajustez librement.`;
    } else {
      el.estimateHint.textContent = estimateExplanation(draft, null);
    }
  });

  el.btnDelete.addEventListener('click', deleteCurrentItem);
  $('btn-cancel').addEventListener('click', () => {
    state.editing = null;
    switchView('list');
  });
  $('item-form').addEventListener('submit', (event) => {
    event.preventDefault();
    void saveItem();
  });

  $('btn-backup').addEventListener('click', () => void backup());
  $('i-restore').addEventListener('change', (event) => {
    if (event.target.files[0]) void restore(event.target.files[0]);
    event.target.value = '';
  });
  $('btn-report').addEventListener('click', () => void buildReport());
  $('btn-wipe').addEventListener('click', () => void wipeAll());

  document.addEventListener('pointerdown', resetLockTimer);
  document.addEventListener('keydown', resetLockTimer);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) resetLockTimer();
  });
}

function removeChip(event) {
  const button = event.target.closest('button[data-remove]');
  if (!button || !state.editing) return;
  const key = button.dataset.remove;
  const kind = button.dataset.kind;
  if (kind === 'photo') {
    state.editing.photos = state.editing.photos.filter((e) => (e.id !== key));
    state.editing.addedPhotos = state.editing.addedPhotos.filter((e) => (e.key !== key));
  } else {
    state.editing.invoices = state.editing.invoices.filter((e) => (e.id !== key));
    state.editing.addedInvoices = state.editing.addedInvoices.filter((e) => (e.key !== key));
  }
  void renderAttachments();
}

init();
