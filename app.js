function pickFirst(...ids){ for (const id of ids){ const el = document.getElementById(id); if (el) return el; } return null; }

// --- Boot overlay to hide initial zoom/fit (prevents visible snapping) ---
function createBootOverlay() {
  if (document.getElementById("bootOverlay")) return;

  const mapEl = document.getElementById("map");
  if (!mapEl) return;

  // Ensure overlay is positioned relative to the map container
  const cs = window.getComputedStyle(mapEl);
  if (cs.position === "static") mapEl.style.position = "relative";

  const ov = document.createElement("div");
  ov.id = "bootOverlay";
  ov.style.position = "absolute";
  ov.style.inset = "0";
  ov.style.background = "#7fc2dd";
  // Above tiles/markers, below sidebar
  ov.style.zIndex = "900";
  ov.style.opacity = "1";
  ov.style.pointerEvents = "none";
  ov.style.transition = "opacity 120ms ease";

  // Hide markers/tooltips briefly so they don't appear over the boot overlay
  const _m = window.__leafletMap;
  if (_m && _m.getPane) {
    const panesToHide = ["markerPane", "shadowPane", "tooltipPane", "popupPane"];
    panesToHide.forEach((p) => {
      const el = _m.getPane(p);
      if (el) el.style.opacity = "0";
    });
  }

  mapEl.appendChild(ov);
}
function hideBootOverlay() {
  const ov = document.getElementById("bootOverlay");
  if (!ov) return;
  // keep it up briefly so tiles render before fade
  setTimeout(() => {
    ov.style.opacity = "0";

    // Restore marker/tooltip/popup panes now that overlay is fading out
    const _m = window.__leafletMap;
    if (_m && _m.getPane) {
      const panesToShow = ["markerPane", "shadowPane", "tooltipPane", "popupPane"];
      panesToShow.forEach((p) => {
        const el = _m.getPane(p);
        if (el) el.style.opacity = "1";
      });
    }

    setTimeout(() => ov.remove(), 160);
  }, 150);
}

createBootOverlay();
// ================================
// CONFIG
// ================================
const IMAGE_WIDTH = 8192;
const IMAGE_HEIGHT = 8192;
const imageBounds = L.latLngBounds([[0,0],[IMAGE_HEIGHT, IMAGE_WIDTH]]);


let categories = {};
let pinTypes = {};
let activePinType = null;
let markers = [];

const STORAGE_KEY = "gta_map_cache_v2";

const defaultColors = [
  "#e74c3c","#2ecc71","#3498db",
  "#f39c12","#9b59b6","#1abc9c",
  "#e84393","#6c5ce7","#fd79a8",
  "#fdcb6e","#00b894","#0984e3"
];

// ================================
// PIN EDIT (Alt+Click) + IMAGE LIGHTBOX (URL-only)
// ================================
// Store ONLY an external URL on the pin: pin.imageUrl
// Alt + click pin: opens editor (comment + image URL). Clear to remove.
// Hover: preview image (and comment text if present)
// Normal click: if image exists, open fullscreen lightbox and dim map

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, s => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[s]));
}

function buildTooltipHTML(pin) {
  const imgUrl = pin.imageUrl || "";
  const hasImg = !!imgUrl;
  const hasText = !!pin.comment;

  if (!hasImg && !hasText) return "";

  let html = '<div class="pin-tooltip-wrap">';
  if (hasImg) html += `<img class="pin-tooltip-img" src="${escapeHtml(imgUrl)}" alt="" referrerpolicy="no-referrer">`;
  if (hasText) html += `<div class="pin-tooltip-text">${escapeHtml(pin.comment)}</div>`;
  html += "</div>";
  return html;
}

function ensureMarkerTooltip(marker) {
  const pin = marker.pinData;
  if (!pin) return;

  const html = buildTooltipHTML(pin);

  if (!html) {
    if (marker.getTooltip && marker.getTooltip()) marker.unbindTooltip();
    return;
  }

  if (marker.getTooltip && marker.getTooltip()) {
    marker.setTooltipContent(html);
  } else if (marker.bindTooltip) {
    marker.bindTooltip(html, {
      permanent: false,
      direction: "top",
      offset: [0, -8],
      className: "pin-tooltip",
      opacity: 1
    });
  }
}

// --- Lightbox ---
let __lightboxEl = null;
function ensureLightbox() {
  if (__lightboxEl) return __lightboxEl;
  const el = document.createElement("div");
  el.id = "pinLightbox";
  el.className = "pin-lightbox hidden";
  el.innerHTML = `
    <div class="pin-lightbox-backdrop"></div>
    <div class="pin-lightbox-status hidden" id="pinLightboxStatus">Loading…</div>
    <img class="pin-lightbox-img" alt="" referrerpolicy="no-referrer" referrerpolicy="no-referrer">
  `;
  document.body.appendChild(el);

  el.addEventListener("click", () => closeLightbox());
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });

  __lightboxEl = el;
  return el;
}

function openLightbox(url) {
  if (!url) return;
  const el = ensureLightbox();
  const img = el.querySelector(".pin-lightbox-img");
  const status = el.querySelector("#pinLightboxStatus");

  // reset mode
  el.classList.remove("lightbox-actual");

  const attempts = [];
  // 1) original URL (no modifications)
  attempts.push(url);
  // 2) cache-bust (some browsers cache prior failures)
  attempts.push((url.includes("?") ? url + "&" : url + "?") + "cb=" + Date.now());

  let i = 0;
  function tryNext() {
    const u = attempts[i++];
    if (!u) {
      status.textContent = "Image failed to load (check URL / host hotlinking).";
      status.classList.remove("hidden");
      return;
    }
    status.textContent = "Loading…";
    status.classList.remove("hidden");
    try { img.referrerPolicy = "no-referrer"; } catch {}
    img.onload = () => {
      status.classList.add("hidden");
    };
    img.onerror = () => {
      tryNext();
    };
    img.src = u;
  }

  el.classList.remove("hidden");
  tryNext();

  // Disable map interactions while open
  try {
    map.dragging.disable();
    map.scrollWheelZoom.disable();
    map.doubleClickZoom && map.doubleClickZoom.disable();
    map.boxZoom && map.boxZoom.disable();
    map.keyboard && map.keyboard.disable();
    map.touchZoom && map.touchZoom.disable();
  } catch {}
}

function closeLightbox() {
  if (!__lightboxEl) return;
  __lightboxEl.classList.add("hidden");
  const img = __lightboxEl.querySelector(".pin-lightbox-img");
  const status = __lightboxEl.querySelector("#pinLightboxStatus");
  if (status) status.classList.add("hidden");
  if (img) img.src = "";

  try {
    map.dragging.enable();
    map.scrollWheelZoom.enable();
    map.doubleClickZoom && map.doubleClickZoom.disable(); // keep doubleclick disabled
    map.boxZoom && map.boxZoom.enable();
    map.keyboard && map.keyboard.enable();
    map.touchZoom && map.touchZoom.enable();
  } catch {}
}

// --- Alt-click edit modal ---
let __pinEditModal = null;
let __editingMarker = null;

function ensurePinEditModal() {
  if (__pinEditModal) return __pinEditModal;

  const el = document.createElement("div");
  el.id = "pinEditModal";
  el.className = "pin-edit-modal hidden";
  el.innerHTML = `
    <div class="pin-edit-card" role="dialog" aria-modal="true">
      <div class="pin-edit-title">Edit pin</div>

      <label class="pin-edit-label">Comment</label>
      <textarea id="pinEditComment" class="pin-edit-textarea" rows="3" placeholder="Optional..."></textarea>

      <label class="pin-edit-label">Image URL</label>
      <input id="pinEditImageUrl" class="pin-edit-input" type="text" placeholder="https://...">

      <div class="pin-edit-actions">
        <button id="pinEditCancel" class="pin-edit-btn secondary" type="button">Cancel</button>
        <button id="pinEditClear" class="pin-edit-btn secondary" type="button">Clear</button>
        <button id="pinEditSave" class="pin-edit-btn primary" type="button">Save</button>
      </div>
      <div class="pin-edit-hint">Alt + click pins to edit later.</div>
    </div>
  `;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target === el) closePinEditModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePinEditModal();
  });

  // Wire buttons once
  el.querySelector("#pinEditCancel").addEventListener("click", closePinEditModal);
  el.querySelector("#pinEditClear").addEventListener("click", () => {
    el.querySelector("#pinEditComment").value = "";
    el.querySelector("#pinEditImageUrl").value = "";
  });
  el.querySelector("#pinEditSave").addEventListener("click", () => {
    const m = __editingMarker;
    if (!m || !m.pinData) return closePinEditModal();

    const comment = el.querySelector("#pinEditComment").value.trim();
    const imageUrl = el.querySelector("#pinEditImageUrl").value.trim();

    if (comment) m.pinData.comment = comment;
    else delete m.pinData.comment;

    if (imageUrl) {
      if (!/^https?:\/\/.+/i.test(imageUrl)) {
        alert("Image URL must start with http:// or https://");
        return;
      }
      m.pinData.imageUrl = imageUrl;
    } else {
      delete m.pinData.imageUrl;
    }

    ensureMarkerTooltip(m);
    saveToCache();
    closePinEditModal();
  });

  __pinEditModal = el;
  return el;
}

function openPinEditModal(marker) {
  const el = ensurePinEditModal();
  __editingMarker = marker;

  const pin = marker.pinData || {};
  el.querySelector("#pinEditComment").value = pin.comment || "";
  el.querySelector("#pinEditImageUrl").value = pin.imageUrl || "";

  el.classList.remove("hidden");
}

function closePinEditModal() {
  if (!__pinEditModal) return;
  __pinEditModal.classList.add("hidden");
  __editingMarker = null;
}

// --- Pencil cursor while holding Alt ---
(function setupAltCursor(){
  let altDown = false;

  function isTypingTarget(t){
    if(!t) return false;
    const tag = (t.tagName||"").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || t.isContentEditable;
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Alt") {
      if (!isTypingTarget(e.target)) e.preventDefault(); // best-effort
      if (!altDown) {
        altDown = true;
        document.body.classList.add("alt-edit-mode");
      }
    }
  }, true);

  window.addEventListener("keyup", (e) => {
    if (e.key === "Alt") {
      if (!isTypingTarget(e.target)) e.preventDefault();
      altDown = false;
      document.body.classList.remove("alt-edit-mode");
    }
  }, true);

  window.addEventListener("blur", () => {
    altDown = false;
    document.body.classList.remove("alt-edit-mode");
  });
})();
;// Support older saves: pin.image -> pin.imageUrl (URLs only)
function migratePinImageField(pin) {
  if (!pin) return;
  if (pin.image && !pin.imageUrl) {
    const v = String(pin.image);
    if (/^https?:\/\/.+/i.test(v)) pin.imageUrl = v;
    delete pin.image;
  }
}
// ================================
// MAP SETUP
// ================================
const map = L.map("map", {
  worldCopyJump: false,
  easeLinearity: 0.25,
  inertiaMaxSpeed: 2000,
  inertiaDeceleration: 3000,
  markerZoomAnimation: false,
  fadeAnimation: false,
  preferCanvas: true,
  crs: L.CRS.Simple,
  zoomSnap: 0,
  zoomDelta: 0.25,
  wheelPxPerZoomLevel: 80,
  zoomAnimation: false,
  doubleClickZoom: false,
  inertia: true,
  maxBoundsViscosity: 0.6,
  attributionControl: false,
  zoomControl: false
});


// Prevent any startup "fit/re-apply" logic from snapping the zoom after the user begins interacting.
window.__userInteracted = false;
map.on("dragstart", () => { window.__userInteracted = true; });
map.on("zoomstart", () => { window.__userInteracted = true; });
map.on("movestart", () => { window.__userInteracted = true; });
const overlay = L.imageOverlay("gtav-map.png", imageBounds).addTo(map);

// Compute a stable "fit to viewport" zoom for the full image.
// We start at the *max zoom-out level* (minZoom) so the full map is visible with extra margin,
// but we cap how far the user can zoom out so it never becomes tiny.
let _fitZoom = null;
let _minZoom = null;
let _maxZoom = null;

function computeFitZoom() {
  // Small padding gives breathing room around the image.
  const padding = [0, 0];
  return map.getBoundsZoom(imageBounds, false, padding);
}

function applyInitialViewport(force = false) {
  map.invalidateSize(true);

  const nextFit = computeFitZoom();
  const zoomOutAllowance = 2.6;      // how much further out than "fit" the user can go
  const startOutAllowance = 2;     // start more zoomed out than fit

  const nextMin = nextFit - zoomOutAllowance;
  const nextStart = nextFit - startOutAllowance;

  // Keep zoom limits stable after first compute, but update them on resize.
  _fitZoom = (_fitZoom === null || force) ? nextFit : _fitZoom;
  _minZoom = (_minZoom === null || force) ? nextMin : _minZoom;

  if (_maxZoom === null || force) _maxZoom = _fitZoom + 3.0;

  map.setMinZoom(_minZoom);
  map.setMaxZoom(_maxZoom);

  // Center on the image (prevents the "panned to bottom" feel)
  const center = imageBounds.getCenter();

  if (force) {
    // Start already at the desired zoom level so there's no visible snap.
    // We also keep the map hidden until this runs (CSS) to avoid a jump on slow loads.
    map.setView(center, nextStart, { animate: false });
    document.body.classList.add("map-ready");
  } else {
    // On resize: do NOT recompute zoom limits based on new fit (prevents 'zoom gets fucked').
    // Just update Leaflet sizing and clamp the current zoom into the original limits.
    try { map.invalidateSize({ pan: false, debounceMoveend: true }); } catch(e) {}
    const z = map.getZoom();
    if (z < _minZoom) map.setZoom(_minZoom, { animate: false });
    if (_maxZoom !== null && z > _maxZoom) map.setZoom(_maxZoom, { animate: false });
  }
}

// Run after the overlay + container have painted.
function scheduleInitialViewport() {
  document.body.classList.remove("map-ready");
  requestAnimationFrame(() => {
    requestAnimationFrame(() => (!window.__userInteracted && applyInitialViewport(true)));
  });
}


// Apply initial viewport once the image is loaded *and* layout has settled.
// GitHub Pages can apply CSS/fonts slightly later than local dev, which changes map size.
function stabilizeAndApplyInitialViewport() {
  // Debounce multiple triggers into one final apply
  if (window.__stabilizeTimer) clearTimeout(window.__stabilizeTimer);
  window.__stabilizeTimer = setTimeout(() => {
    try { (!window.__userInteracted && applyInitialViewport(true)); } catch (e) {}
  }, 140);
}

// When the map image overlay finishes loading, start stabilization.
overlay.once("load", () => {
  stabilizeAndApplyInitialViewport();
});

// Also trigger once fonts are ready (can change sidebar width -> map size).
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => stabilizeAndApplyInitialViewport()).catch(() => {});
}

// And once on full window load.
window.addEventListener("load", () => {
  stabilizeAndApplyInitialViewport();
}, { once: true });

// Watch map container size briefly and re-apply after it stabilizes (prevents wrong first zoom on GH Pages).
(() => {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof ResizeObserver === "undefined") return;

  let lastW = 0, lastH = 0;
  let changes = 0;
  const ro = new ResizeObserver((entries) => {
    const cr = entries && entries[0] && entries[0].contentRect;
    if (!cr) return;
    const w = Math.round(cr.width);
    const h = Math.round(cr.height);
    if (Math.abs(w - lastW) < 6 && Math.abs(h - lastH) < 6) return;
    lastW = w; lastH = h;
    changes++;
    stabilizeAndApplyInitialViewport();
    // stop after a few real changes
    if (changes >= 6) {
      try { ro.disconnect(); } catch(e){}
    }
  });

  ro.observe(mapEl);
  setTimeout(() => { try { ro.disconnect(); } catch(e){} }, 3500);
})();

// Ensure first-load zoom matches refresh (wait for full CSS/layout)
window.addEventListener("load", () => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => (!window.__userInteracted && applyInitialViewport(true)));
  });
}, { once: true });
// Fallback for cached images that may not fire "load" predictably.
setTimeout(scheduleInitialViewport, 0);

// On resize: update min/max zoom, but do NOT refit/teleport.
window.addEventListener("resize", () => requestAnimationFrame(() => applyInitialViewport(false)));

// Softer imageBounds so it doesn't feel "on rails" when fully zoomed out.
const softBounds = L.latLngBounds(imageBounds).pad(0.08); // ~8% padding all around
map.setMaxBounds(softBounds);
// Only gently pull back *after* dragging, allowing a little overscroll while dragging.
map.on("dragend", () => map.panInsideBounds(softBounds, { animate: false }));

// ================================
// DOM
// ================================
const categoriesContainer = document.getElementById("categoriesContainer");
const categorySelectWrapper = document.getElementById("categorySelect");
const newCategoryName = pickFirst("newUnifiedName","newCategoryName");
const newPinName = pickFirst("newUnifiedName","newPinName");
const newPinColor = document.getElementById("newPinColor");

// ================================
// STORAGE
// ================================
function saveToCache(){
  const data = {
    categories,
    pinTypes,
    pins: markers.map(m=>m.pinData)
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadFromCache(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return;

  try{
    const data = JSON.parse(raw);
    categories = data.categories || {};
    pinTypes = data.pinTypes || {};
    activePinType = null;

    data.pins.forEach(p=>addPin(p));
    renderCategories();
    renderCategorySelect();
    refreshAllPinTooltips();
  }catch(e){
    console.warn("Cache load failed");
  }
  refreshAllPinTooltips();
}


// ================================
// HELPERS
// ================================
function nextColor(){
  const used = Object.values(pinTypes).map(p=>p.color);
  return defaultColors.find(c=>!used.includes(c)) || "#555";
}

// ================================
// PIN CREATION
// ================================
function addPin(pin){
  const pinType = pinTypes[pin.type];
  if(!pinType) return;

  const marker = L.marker([pin.y, pin.x], {
    draggable: movePinsEnabled,
    icon: L.divIcon({
      html:`<div class="custom-pin" style="background:${pinType.color};"></div>`,
      iconSize:[10,10],
      iconAnchor:[5,5],
      className: "custom-marker"
    })
  });

  marker.pinData = pin;
  
  
  ensureMarkerTooltip(marker);

  // Enable/disable dragging based on Move Pins mode
  if (marker.dragging) {
    if (movePinsEnabled) marker.dragging.enable();
    else marker.dragging.disable();
  }

  // Persist new position when moved
  marker.on("dragend", ()=>{
    const ll = marker.getLatLng();
    marker.pinData.x = ll.lng;
    marker.pinData.y = ll.lat;
    saveToCache();
  });

markers.push(marker);

  const category = categories[pinType.category];
  if(category && category.visible && pinType.visible){
    marker.addTo(map);
  }


  // Allow deleting pins even when the click is captured by the marker (Leaflet stops map click propagation)
  marker.on("click", (ev)=>{
    const oe = ev && ev.originalEvent;

    // Alt + click: add/remove image URL (only when not deleting)
    if(!deleting && oe && oe.altKey){
      oe.preventDefault && oe.preventDefault();
      oe.stopPropagation && oe.stopPropagation();
      ev.preventDefault && ev.preventDefault();
      ev.stopPropagation && ev.stopPropagation();
      openPinEditModal(marker);
      return;
    }

    // Normal click: open large image if present (only when not deleting)
    if(!deleting && marker.pinData && marker.pinData.imageUrl){
      oe && oe.preventDefault && oe.preventDefault();
      oe && oe.stopPropagation && oe.stopPropagation();
      ev.preventDefault && ev.preventDefault();
      ev.stopPropagation && ev.stopPropagation();
      openLightbox(marker.pinData.imageUrl);
      return;
    }

    const isDeleting = deleting || (oe && oe.ctrlKey);
    if(!isDeleting) return;

    // Prevent any other interactions while deleting
    ev.originalEvent && ev.originalEvent.preventDefault && ev.originalEvent.preventDefault();
    ev.originalEvent && ev.originalEvent.stopPropagation && ev.originalEvent.stopPropagation();
    ev.preventDefault && ev.preventDefault();
    ev.stopPropagation && ev.stopPropagation();

    if(confirm("Delete this pin?")){
      map.removeLayer(marker);
      markers = markers.filter(x=>x!==marker);
      saveToCache();
    }
  });

  saveToCache();
  return marker;
}

// ================================
// INPUT MODES
// ================================
let placing = false;
let deleting = false;
let movePinsEnabled = false;

function setDeleting(on){
  const next = !!on;
  if(next === deleting) return;
  deleting = next;
  document.body.classList.toggle("delete-active", deleting);
  if(deleting){
    // Ensure any open tooltips are closed immediately when entering delete mode
    markers.forEach(m=>{ try{ m.closeTooltip(); }catch(_){} });
  }
  applyCursorState();
}

function setPlacing(on){
  const next = !!on;
  if(next === placing) return;
  placing = next;
  applyCursorState();
}

function applyCursorState(){
  const el = map.getContainer();
  el.classList.toggle("place-pin-cursor", placing);
  el.classList.toggle("delete-pin-cursor", deleting);
}

function resetInputModes(){
  setPlacing(false);
  setDeleting(false);
}

// If keydown is missed (e.g. Ctrl already held when the window regains focus),
// sync modifier state from pointer events over the map.
function syncModifierState(ev){
  if(!ev) return;
  // Use modifier flags from the current event as source of truth
  setDeleting(!!ev.ctrlKey);
  setPlacing(!!ev.shiftKey);
}

// Key tracking (robust against missed keyup events)
window.addEventListener("keydown", e=>{
  if(e.key === "Shift"){
    setPlacing(true);
  }
  if(e.key === "Control"){
    setDeleting(true);
  }
});

window.addEventListener("keyup", e=>{
  if(e.key === "Shift"){
    setPlacing(false);
  }
  if(e.key === "Control"){
    setDeleting(false);
  }
});

// If the tab/window loses focus, don’t allow modes/cursors to get stuck
window.addEventListener("blur", resetInputModes);
document.addEventListener("visibilitychange", ()=>{
  if(document.hidden) resetInputModes();
});

// Pointer-based sync so holding Ctrl/Shift BEFORE focusing the window still
// activates the correct cursor/mode as soon as the user interacts with the map.
const mapEl = map.getContainer();
["mouseenter","mousemove","mousedown","mouseup"].forEach(evt=>{
  mapEl.addEventListener(evt, (e)=> syncModifierState(e));
});

// ================================
// MAP CLICK
// ================================
map.on("click", e=>{
  const clickPoint = map.latLngToContainerPoint(e.latlng);

  // Fall back to the actual click modifier state (prevents "stuck" modes if keyup is missed)
  const isDeleting = deleting || (e.originalEvent && e.originalEvent.ctrlKey);
  const isPlacing = (placing || (e.originalEvent && e.originalEvent.shiftKey)) && !isDeleting;

  // DELETE MODE (CTRL)
  if(isDeleting){
    for(const m of markers){
      const p = map.latLngToContainerPoint(m.getLatLng());
      if(p.distanceTo(clickPoint) < 12){
        if(confirm("Delete this pin?")){
          map.removeLayer(m);
          markers = markers.filter(x=>x!==m);
          saveToCache();
        }
        return;
      }
    }
    return;
  }

  // PLACE MODE (SHIFT)
  if(!isPlacing) return;

  if(!activePinType){
    alert("Select a pin type first");
    return;
  }

  const comment = prompt("Pin comment (optional):");
  addPin({
    x:e.latlng.lng,
    y:e.latlng.lat,
    comment:comment||"",
    type:activePinType
  });

  placing = false;
  applyCursorState();
});

// ================================
// CATEGORIES UI
// ================================
function renderCategories(){
  categoriesContainer.innerHTML = "";

  for(const catName in categories){
    const category = categories[catName];

    const catHeader = document.createElement("div");
    catHeader.className = "category-header";
    catHeader.innerHTML = `
      <div class="category-header-left">
        <span class="category-toggle">${category.collapsed ? "▶" : "▼"}</span>
        <span class="category-eye">${category.visible ? "👁" : "🚫"}</span>
        <strong>${catName}</strong>
      </div>
      <div class="category-header-actions">
        <button class="category-rename" data-category="${catName}" title="Rename">✎</button>
        <button class="category-delete" data-category="${catName}" title="Delete">×</button>
      </div>
    `;

    catHeader.querySelector(".category-toggle").onclick = (ev)=>{ if(ev) ev.stopPropagation();
      category.collapsed = !category.collapsed;
      saveToCache();
      renderCategories();
    };

    catHeader.querySelector(".category-eye").onclick = (ev)=>{
      if(ev) ev.stopPropagation();
      const turningOn = !category.visible;
      category.visible = turningOn;

      // When turning category ON, reset all pin types in this category to visible.
      if(turningOn){
        Object.keys(pinTypes).forEach(tn=>{
          const pt = pinTypes[tn];
          if(pt && pt.category === catName) pt.visible = true;
        });
      }

      // Apply effective visibility to markers in this category.
      markers.forEach(m=>{
        const pt = pinTypes[m.pinData.type];
        if(pt && pt.category === catName){
          const show = !!(category.visible && pt.visible);
          if(show) m.addTo(map);
          else map.removeLayer(m);
        }
      });

      saveToCache();
      renderCategories();
    };

    
    const renameBtn = catHeader.querySelector(".category-rename");
    renameBtn.onclick = ()=>{
      const next = prompt("Rename category:", catName);
      if(!next) return;
      const newName = next.trim();
      if(!newName || newName===catName) return;
      if(categories[newName]){
        alert("A category with that name already exists.");
        return;
      }
      // Move category object
      categories[newName] = categories[catName];
      delete categories[catName];

      // Update pinTypes that reference this category
      Object.keys(pinTypes).forEach(t=>{
        if(pinTypes[t].category === catName) pinTypes[t].category = newName;
      });

      // Rebuild category dropdown + rerender
      saveToCache();
      renderCategorySelect();
    refreshAllPinTooltips();
      renderCategories();
    };

  catHeader.querySelector(".category-delete").onclick = ()=>{
      if(!confirm(`Delete category "${catName}" and all its pin types?`)) return;

      // Delete all pin types and pins in this category
      const typesToDelete = Object.keys(pinTypes).filter(t=>pinTypes[t].category===catName);
      typesToDelete.forEach(type=>{
        markers.filter(m=>m.pinData.type===type).forEach(m=>map.removeLayer(m));
        markers = markers.filter(m=>m.pinData.type!==type);
        delete pinTypes[type];
      });

      delete categories[catName];
      activePinType = null;
      saveToCache();
      renderCategories();
      renderCategorySelect();
    refreshAllPinTooltips();
    };

    categoriesContainer.appendChild(catHeader);

    // Pin types list (collapsible)
    if(!category.collapsed){
      const pinTypesInCat = Object.keys(pinTypes).filter(t=>pinTypes[t].category===catName);

      if(pinTypesInCat.length === 0){
        const emptyMsg = document.createElement("div");
        emptyMsg.className = "pin-type-empty";
        emptyMsg.textContent = "No pins yet";
        categoriesContainer.appendChild(emptyMsg);
      } else {
        pinTypesInCat.forEach(typeName=>{
          const pinType = pinTypes[typeName];
          const row = document.createElement("div");
          row.className = "pin-type-row";

          const eye = document.createElement("span");
          eye.className = "pin-type-eye";
          const cat = categories[pinType.category];
          const effectiveVisible = (!!cat && cat.visible && pinType.visible);
          eye.textContent = effectiveVisible ? "👁" : "🚫";
          if(cat && !cat.visible) eye.classList.add("disabled-by-category");
          eye.onclick = (ev)=>{
            if(ev) ev.stopPropagation();

            const cat = categories[pinType.category];
            const turningOn = !pinType.visible;

            if (turningOn) {
              // If category is hidden, unhide it and solo this pin type (others off)
              if (cat && !cat.visible) {
                cat.visible = true;
                Object.keys(pinTypes).forEach(tn=>{
                  const pt = pinTypes[tn];
                  if(pt && pt.category === pinType.category) pt.visible = (tn === typeName);
                });
              } else {
                // Normal: just enable this pin type
                pinType.visible = true;
              }
            } else {
              pinType.visible = false;
            }

            // Apply visibility for this category (since solo may have changed others)
            Object.keys(pinTypes).forEach(tn=>{
              const pt = pinTypes[tn];
              if(!pt || pt.category !== pinType.category) return;
              const c = categories[pt.category];
              const show = !!(c && c.visible && pt.visible);
              markers
                .filter(m=>m.pinData.type===tn)
                .forEach(m=>{
                  if(show) m.addTo(map);
                  else map.removeLayer(m);
                });
            });

            saveToCache();
            renderCategories();
            renderPinTypes();
          };

          const radio = document.createElement("input");
          radio.type = "radio";
          radio.name = "activeType";
          radio.checked = activePinType === typeName;
          radio.onchange = ()=> activePinType = typeName;

          const label = document.createElement("label");
          label.className = "pin-type-label";
          label.textContent = typeName;
          const actions = document.createElement("div");
          actions.className = "pin-type-actions";
          // Make the whole row clickable (better UX than tiny eye when greyed out)
          row.onclick = (ev)=>{
            if(ev) ev.stopPropagation();
            // Ignore clicks on the eye itself or action buttons (they handle their own clicks)
            if(ev.target && (ev.target.classList && ev.target.classList.contains("pin-type-eye"))) return;
            if(ev.target && ev.target.closest && ev.target.closest(".pin-type-actions")) return;
            // Delegate to the same logic as the eye
            eye.onclick(ev);
          };
          row.style.cursor = "pointer";

          // Static color dot next to delete (click dot to change color)
          const colorDot = document.createElement("span");
          colorDot.className = "pin-type-color-dot";
          colorDot.style.background = pinType.color;

          const colorInput = document.createElement("input");
          colorInput.type = "color";
          colorInput.value = pinType.color;
          colorInput.className = "pin-type-color-input"; // hidden via CSS
          colorInput.oninput = ()=>{
            pinType.color = colorInput.value;
            colorDot.style.background = pinType.color;
            markers
              .filter(m=>m.pinData.type===typeName)
              .forEach(m=>{
                const el = m._icon && m._icon.querySelector(".custom-pin");
                if(el) el.style.background = pinType.color;
              });
            saveToCache();
          };

          colorDot.onclick = (e)=>{
            e.stopPropagation();
            colorInput.click();
          };

          const del = document.createElement("button");
          del.textContent = "×";
          del.className = "pin-type-delete";
          del.onclick = ()=>{
            if(!confirm(`Delete "${typeName}" and all its pins?`)) return;
            markers.filter(m=>m.pinData.type===typeName).forEach(m=>map.removeLayer(m));
            markers = markers.filter(m=>m.pinData.type!==typeName);
            delete pinTypes[typeName];
            activePinType = null;
            saveToCache();
            renderCategories();
          };

          // Rename button
          const ren = document.createElement("button");
          ren.textContent = "✎";
          ren.className = "pin-type-rename";
          ren.title = "Rename";
          ren.onclick = (e)=>{
            e.stopPropagation();
            const next = prompt("Rename pin:", typeName);
            if(!next) return;
            const newName = next.trim();
            if(!newName || newName===typeName) return;
            if(pinTypes[newName]){
              alert("A pin with that name already exists.");
              return;
            }
            // Move pin type
            pinTypes[newName] = pinTypes[typeName];
            delete pinTypes[typeName];

            // Update markers
            markers.forEach(m=>{
              if(m.pinData.type===typeName) m.pinData.type = newName;
            });

            if(activePinType === typeName) activePinType = newName;
            saveToCache();
            renderCategories();
          };

          actions.append(colorDot, colorInput, ren, del);
          row.append(eye, radio, label, actions);
          categoriesContainer.appendChild(row);
        });
      }
    }
  }

  if(Object.keys(categories).length === 0){
    const emptyMsg = document.createElement("div");
    emptyMsg.className = "empty-state";
    emptyMsg.textContent = "Create a category to get started";
    categoriesContainer.appendChild(emptyMsg);
  }
}

function renderCategorySelect(){
  categorySelectWrapper.innerHTML = "";

  const catNames = Object.keys(categories);
  if(catNames.length === 0){
    const msg = document.createElement("p");
    msg.className = "category-select-empty";
    msg.textContent = "Create a category first";
    categorySelectWrapper.appendChild(msg);
    return;
  }

  const select = document.createElement("select");
  select.id = "categorySelectDropdown";
  select.className = "category-select";

  catNames.forEach(name=>{
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    select.appendChild(opt);
  });

  categorySelectWrapper.appendChild(select);
}

// ================================
// ADD CATEGORY
// ================================
pickFirst("addCategoryUnified","addCategory").onclick = ()=>{
  const name = newCategoryName.value.trim();
  if(!name) return alert("Enter a category name");
  if(categories[name]) return alert("Category already exists");

  categories[name] = {
    visible: true,
    collapsed: false
  };

  newCategoryName.value = "";
  saveToCache();
  renderCategories();
  renderCategorySelect();
    refreshAllPinTooltips();
};

// ================================
// ADD PIN TYPE
// ================================
pickFirst("addPinTypeUnified","addPinType").onclick = ()=>{
  const name = newPinName.value.trim();
  if(!name) return alert("Enter a pin type name");
  if(pinTypes[name]) return alert("Pin type already exists");

  const select = document.getElementById("categorySelectDropdown");
  if(!select) return alert("Create a category first");

  const category = select.value;

  pinTypes[name] = {
    color: newPinColor.value || nextColor(),
    visible: true,
    category: category
  };

  activePinType = name;
  newPinName.value = "";
  newPinColor.value = nextColor();
  saveToCache();
  renderCategories();
};

newPinColor.value = nextColor();

// ================================
// EXPORT / IMPORT
// ================================
document.getElementById("exportPins").onclick = ()=>{
  const data = {
    categories,
    pinTypes,
    pins: markers.map(m=>m.pinData)
  };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gta-map.json";
  a.click();
};

document.getElementById("importBtn").onclick = ()=>{
  document.getElementById("importPins").click();
};


// ================================
// IMPORT MERGE + MOVE PINS UI
// ================================
(function setupImportMergeAndMovePinsUI(){
  const importBtnEl = document.getElementById("importBtn");
  const importFileEl = document.getElementById("importPins");
  if (!importBtnEl || !importFileEl) return;

  // Merge checkbox next to Import
  if (!document.getElementById("mergeImportCheckbox")) {
    const wrap = document.createElement("label");
    wrap.className = "import-merge-wrap";
    wrap.innerHTML = `<input id="mergeImportCheckbox" type="checkbox"> Merge`;
  // Force default off (and prevent browser restoring state)
  setTimeout(()=>{ const m=document.getElementById("mergeImportCheckbox"); if(m) m.checked=false; },0);

    importBtnEl.parentNode && importBtnEl.parentNode.insertBefore(wrap, importBtnEl.nextSibling);
  
  const mergeCbNow = wrap.querySelector("#mergeImportCheckbox");
  if (mergeCbNow) mergeCbNow.checked = false;
}

  // Move pins checkbox (placed after import controls)
  if (!document.getElementById("movePinsCheckbox")) {
    const moveWrap = document.createElement("label");
    moveWrap.className = "move-pins-wrap";
    moveWrap.innerHTML = `<input id="movePinsCheckbox" type="checkbox"> Move pins`;
    (importBtnEl.parentNode || document.body).appendChild(moveWrap);

    const moveCb = moveWrap.querySelector("#movePinsCheckbox");
    
  // Force default off (and prevent browser restoring state)
  moveCb.checked = false;
  movePinsEnabled = false;
moveCb.addEventListener("change", ()=>{
      movePinsEnabled = !!moveCb.checked;
      markers.forEach(m=>{
        if (!m.dragging) return;
        if (movePinsEnabled) m.dragging.enable();
        else m.dragging.disable();
      });
    });
  }
})();


document.getElementById("importPins").onchange = e=>{
  const reader = new FileReader();
  reader.onload = ev=>{
    const data = JSON.parse(ev.target.result);
    const merge = !!document.getElementById("mergeImportCheckbox")?.checked;

    const norm = (s)=>String(s||"").trim().toLowerCase();

    if(!merge){
      markers.forEach(m=>map.removeLayer(m));
      markers = [];
      categories = data.categories || {};
      pinTypes = data.pinTypes || {};
      activePinType = null;

      (data.pins || []).forEach(p=>{
        migratePinImageField(p);
        addPin(p);
      });

      saveToCache();
      renderCategories();
      renderCategorySelect();
    refreshAllPinTooltips();
      return;
    }

    // --- Merge mode (no duplicates) ---
    const existingCatNames = new Map(Object.keys(categories).map(k=>[norm(k), k]));
    const existingTypeKeys = new Map(Object.keys(pinTypes).map(k=>{
      const t = pinTypes[k];
      return [norm(k)+"|"+norm(t?.category), k];
    }));

    // Merge categories by name
    for(const catName in (data.categories||{})){
      if(!existingCatNames.has(norm(catName))){
        categories[catName] = data.categories[catName];
        existingCatNames.set(norm(catName), catName);
      }
    }

    // Merge pin types by name+category
    for(const typeName in (data.pinTypes||{})){
      const t = data.pinTypes[typeName];
      const key = norm(typeName)+"|"+norm(t?.category);
      if(!existingTypeKeys.has(key)){
        if(t && t.category && existingCatNames.has(norm(t.category))){
          t.category = existingCatNames.get(norm(t.category));
        }
        pinTypes[typeName] = t;
        existingTypeKeys.set(key, typeName);
      }
    }

    // Existing pin signatures
    const sig = (p)=>`${Number(p.x).toFixed(2)}|${Number(p.y).toFixed(2)}|${norm(p.type)}|${norm(p.comment)}|${norm(p.imageUrl)}`;
    const existingSigs = new Set(markers.map(m=>sig(m.pinData||{})));

    (data.pins || []).forEach(p=>{
      migratePinImageField(p);
      const s = sig(p);
      if(existingSigs.has(s)) return;
      existingSigs.add(s);
      addPin(p);
    });

    saveToCache();
    renderCategories();
    renderCategorySelect();
    refreshAllPinTooltips();
  };
  reader.readAsText(e.target.files[0]);
};

// ================================
// CLEAR ALL
// ================================
const __clearPinsBtn = document.getElementById("clearPins");
if (__clearPinsBtn) __clearPinsBtn.onclick = ()=>{
  if(!confirm("Delete ALL pins?")) return;
  markers.forEach(m=>map.removeLayer(m));
  markers = [];
  saveToCache();
};

// ================================
// INIT
// ================================
loadFromCache();
renderCategorySelect();
    refreshAllPinTooltips();

requestAnimationFrame(() => requestAnimationFrame(hideBootOverlay));


// Force checkboxes + move pins OFF on pageshow (prevents BFCache restoring checked state)
window.addEventListener("pageshow", () => {
  const m = document.getElementById("mergeImportCheckbox");
  if (m) m.checked = false;

  const mv = document.getElementById("movePinsCheckbox");
  if (mv) mv.checked = false;

  movePinsEnabled = false;
  try {
    markers.forEach(mk => { if (mk.dragging) mk.dragging.disable(); });
  } catch {}
});


function toggleLightboxMode() {
  if (!__lightboxEl) return;
  __lightboxEl.classList.toggle("lightbox-actual");
}


function refreshAllPinTooltips() {
  try {
    markers.forEach(m => {
      if (m && m.pinData) migratePinImageField(m.pinData);
      ensureMarkerTooltip(m);
    });
  } catch {}
}
