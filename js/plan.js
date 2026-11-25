export function defaultPlan() {
  return {
    levels: [
      { id: 'lvl:rdc', name: 'Rez-de-chaussée' },
      { id: 'lvl:etage', name: 'Étage' },
      { id: 'lvl:cave', name: 'Cave' },
      { id: 'lvl:ext', name: 'Extérieur' }
    ],
    zones: []
  };
}

export function zoneLabels(plan) {
  const zones = (plan && plan.zones) || [];
  return [...new Set(zones.map((z) => z.label).filter(Boolean))];
}

const PALETTE = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function createPlanView(container, handlers) {
  const { onChange, onViewZone } = handlers;

  let plan = defaultPlan();
  let currentLevelId = plan.levels[0] ? plan.levels[0].id : null;
  let selectedZoneId = null;

  container.innerHTML = `
    <div class="panel">
      <h2>🗺️ Plan de vos zones de vie</h2>
      <p class="hint">Choisissez un niveau en haut, puis « ＋ Ajouter une zone ». Touchez une zone pour la sélectionner : vous pourrez ensuite la déplacer, la renommer, changer sa couleur et sa taille. « 📂 Voir les biens » filtre l'inventaire sur cette zone.</p>
      <div class="level-tabs" id="plan-levels"></div>
      <div class="inline-actions">
        <button type="button" class="btn primary" id="plan-add-zone">＋ Ajouter une zone</button>
        <span class="hint" id="plan-zone-count"></span>
      </div>
      <div class="plan-canvas" id="plan-canvas"></div>
      <div class="plan-editor" id="plan-editor"></div>
    </div>`;

  const levelsEl = container.querySelector('#plan-levels');
  const canvas = container.querySelector('#plan-canvas');
  const editor = container.querySelector('#plan-editor');
  container.querySelector('#plan-add-zone').addEventListener('click', () => addZone());

  const uid = (prefix) => `${prefix}:${globalThis.crypto.randomUUID()}`;
  const currentLevel = () => plan.levels.find((l) => l.id === currentLevelId) || null;
  const currentZones = () => plan.zones.filter((z) => z.levelId === currentLevelId);
  const selectedZone = () => plan.zones.find((z) => z.id === selectedZoneId) || null;

  function emit() {
    onChange(plan);
  }

  function setPlan(next) {
    plan = next && next.levels ? next : defaultPlan();
    if (!Array.isArray(plan.zones)) plan.zones = [];
    currentLevelId = plan.levels[0] ? plan.levels[0].id : null;
    selectedZoneId = null;
    render();
  }

  function render() {
    renderLevels();
    renderCanvas();
    renderEditor();
    container.querySelector('#plan-zone-count').textContent =
      `${currentZones().length} zone(s) à ce niveau`;
  }

  function renderLevels() {
    levelsEl.innerHTML =
      plan.levels.map((level) =>
        `<button type="button" class="level-tab${level.id === currentLevelId ? ' active' : ''}" data-level="${escapeHtml(level.id)}">${escapeHtml(level.name)}</button>`
      ).join('') +
      '<button type="button" class="level-tab add" data-action="add-level" title="Ajouter un niveau">＋ niveau</button>' +
      (currentLevel()
        ? '<button type="button" class="level-tab small" data-action="rename-level" title="Renommer ce niveau">✎</button>' +
          '<button type="button" class="level-tab small" data-action="delete-level" title="Supprimer ce niveau">🗑</button>'
        : '');
  }

  function renderCanvas() {
    canvas.innerHTML = '';
    for (const zone of currentZones()) {
      const box = document.createElement('div');
      box.className = 'zone-box' + (zone.id === selectedZoneId ? ' selected' : '');
      box.dataset.zoneId = zone.id;
      box.style.left = `${zone.x}%`;
      box.style.top = `${zone.y}%`;
      box.style.width = `${zone.w}%`;
      box.style.height = `${zone.h}%`;
      box.style.background = zone.color;
      box.innerHTML = `<span class="zone-label">${escapeHtml(zone.label)}</span>`;
      const handle = document.createElement('span');
      handle.className = 'zone-resize';
      handle.title = 'Redimensionner (tirer par le coin)';
      box.appendChild(handle);
      wireZone(box, zone, handle);
      canvas.appendChild(box);
    }
  }

  function wireZone(box, zone, handle) {
    const startDrag = (event, mode) => {
      if (event.button !== undefined && event.button !== 0 && event.pointerType === 'mouse') return;
      event.preventDefault();
      try { box.setPointerCapture(event.pointerId); } catch (error) { /* sans capture, le suivi continue */ }
      const rect = canvas.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, zx: zone.x, zy: zone.y, zw: zone.w, zh: zone.h, moved: false };
      const onMove = (ev) => {
        const dx = ((ev.clientX - start.x) / rect.width) * 100;
        const dy = ((ev.clientY - start.y) / rect.height) * 100;
        if (!start.moved && Math.abs(dx) < 0.8 && Math.abs(dy) < 0.8) return;
        start.moved = true;
        if (mode === 'move') {
          zone.x = clamp(start.zx + dx, 0, 100 - zone.w);
          zone.y = clamp(start.zy + dy, 0, 100 - zone.h);
          box.style.left = `${zone.x}%`;
          box.style.top = `${zone.y}%`;
        } else {
          zone.w = clamp(start.zw + dx, 8, 100 - zone.x);
          zone.h = clamp(start.zh + dy, 8, 100 - zone.y);
          box.style.width = `${zone.w}%`;
          box.style.height = `${zone.h}%`;
        }
      };
      const onUp = () => {
        box.removeEventListener('pointermove', onMove);
        box.removeEventListener('pointerup', onUp);
        box.removeEventListener('pointercancel', onUp);
        if (start.moved) {
          emit();
        } else if (mode === 'move') {
          selectedZoneId = zone.id;
          render();
        }
      };
      box.addEventListener('pointermove', onMove);
      box.addEventListener('pointerup', onUp);
      box.addEventListener('pointercancel', onUp);
    };

    box.addEventListener('pointerdown', (event) => {
      if (event.target === handle) return;
      startDrag(event, 'move');
    });
    handle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      startDrag(event, 'resize');
    });
  }

  function renderEditor() {
    const zone = selectedZone();
    if (!zone) {
      editor.innerHTML = '<p class="hint">Touchez une zone pour la modifier, ou « ＋ Ajouter une zone ».</p>';
      return;
    }
    editor.innerHTML = `
      <div class="zone-editor">
        <input id="zone-label" value="${escapeHtml(zone.label)}" maxlength="30" placeholder="Nom de la zone" aria-label="Nom de la zone">
        <input type="color" id="zone-color" value="${escapeHtml(zone.color)}" aria-label="Couleur de la zone" title="Couleur">
        <div class="steppers">
          <span>Largeur
            <button type="button" data-size="w" data-delta="-2" aria-label="Réduire la largeur">−</button>
            <button type="button" data-size="w" data-delta="2" aria-label="Augmenter la largeur">＋</button>
          </span>
          <span>Hauteur
            <button type="button" data-size="h" data-delta="-2" aria-label="Réduire la hauteur">−</button>
            <button type="button" data-size="h" data-delta="2" aria-label="Augmenter la hauteur">＋</button>
          </span>
        </div>
        <button type="button" class="btn ghost" data-action="view">📂 Voir les biens</button>
        <button type="button" class="btn danger" data-action="delete">🗑 Supprimer</button>
      </div>`;

    const labelInput = editor.querySelector('#zone-label');
    labelInput.addEventListener('input', () => {
      zone.label = labelInput.value;
      const box = canvas.querySelector(`[data-zone-id="${zone.id}"] .zone-label`);
      if (box) box.textContent = zone.label;
      emit();
    });

    const colorInput = editor.querySelector('#zone-color');
    colorInput.addEventListener('input', () => {
      zone.color = colorInput.value;
      const box = canvas.querySelector(`[data-zone-id="${zone.id}"]`);
      if (box) box.style.background = zone.color;
      emit();
    });

    editor.querySelectorAll('button[data-size]').forEach((button) => {
      button.addEventListener('click', () => {
        const delta = Number(button.dataset.delta);
        if (button.dataset.size === 'w') zone.w = clamp(zone.w + delta, 8, 100);
        else zone.h = clamp(zone.h + delta, 8, 100);
        render();
        emit();
      });
    });

    editor.querySelector('[data-action="view"]').addEventListener('click', () => {
      onViewZone((zone.label || '').trim() || 'Nouvelle zone');
    });

    editor.querySelector('[data-action="delete"]').addEventListener('click', () => {
      plan.zones = plan.zones.filter((z) => z.id !== zone.id);
      selectedZoneId = null;
      render();
      emit();
    });
  }

  function addZone() {
    if (!currentLevel()) {
      addLevel('Rez-de-chaussée');
    }
    const index = currentZones().length;
    const zone = {
      id: uid('zone'),
      levelId: currentLevelId,
      label: 'Nouvelle zone',
      color: PALETTE[index % PALETTE.length],
      x: clamp(6 + (index % 4) * 25, 0, 72),
      y: clamp(6 + Math.floor(index / 4) * 25, 0, 72),
      w: 20,
      h: 20
    };
    plan.zones.push(zone);
    selectedZoneId = zone.id;
    render();
    emit();
  }

  levelsEl.addEventListener('click', (event) => {
    const levelButton = event.target.closest('[data-level]');
    if (levelButton) {
      currentLevelId = levelButton.dataset.level;
      selectedZoneId = null;
      render();
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const action = actionButton.dataset.action;

    if (action === 'add-level') {
      const name = (prompt('Nom du niveau (ex. Rez-de-chaussée, Étage, Cave, Jardin) :') || '').trim();
      if (!name) return;
      const level = { id: uid('lvl'), name };
      plan.levels.push(level);
      currentLevelId = level.id;
      selectedZoneId = null;
      render();
      emit();
    } else if (action === 'rename-level') {
      const level = currentLevel();
      if (!level) return;
      const name = (prompt('Nom du niveau :', level.name) || '').trim();
      if (!name) return;
      level.name = name;
      render();
      emit();
    } else if (action === 'delete-level') {
      const level = currentLevel();
      if (!level) return;
      if (plan.levels.length <= 1) {
        alert('Il doit rester au moins un niveau.');
        return;
      }
      if (!confirm(`Supprimer le niveau « ${level.name} » et toutes ses zones ?`)) return;
      plan.levels = plan.levels.filter((l) => l.id !== level.id);
      plan.zones = plan.zones.filter((z) => z.levelId !== level.id);
      currentLevelId = plan.levels[0].id;
      selectedZoneId = null;
      render();
      emit();
    }
  });

  canvas.addEventListener('pointerdown', (event) => {
    if (event.target === canvas && selectedZoneId) {
      selectedZoneId = null;
      render();
    }
  });

  return { setPlan, addZone };
}
