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

function computeFitZoom() {
  // Small padding gives breathing room around the image.
  const padding = [0, 0];
  return map.getBoundsZoom(imageBounds, false, padding);
}

function applyInitialViewport(force = false) {
  map.invalidateSize(true);

  const nextFit = computeFitZoom();
  const zoomOutAllowance = 0.6;      // how much further out than "fit" the user can go
  const startOutAllowance = 0.6;     // start at the max zoom-out level (same as min zoom)

  const nextMin = nextFit - zoomOutAllowance;
  const nextStart = nextFit - startOutAllowance;

  // Keep zoom limits stable after first compute, but update them on resize.
  _fitZoom = (_fitZoom === null || force) ? nextFit : _fitZoom;
  _minZoom = (_minZoom === null || force) ? nextMin : nextMin;

  map.setMinZoom(_minZoom);
  map.setMaxZoom(nextFit + 3.0);

  // Center on the image (prevents the "panned to bottom" feel)
  const center = imageBounds.getCenter();

  if (force) {
    // Start already at the desired zoom level so there's no visible snap.
    // We also keep the map hidden until this runs (CSS) to avoid a jump on slow loads.
    map.setView(center, nextStart, { animate: false });
    document.body.classList.add("map-ready");
  } else {
    // On resize, don't teleport the user; just clamp if needed.
    const z = map.getZoom();
    if (z < _minZoom) map.setZoom(_minZoom, { animate: false });
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
  }catch(e){
    console.warn("Cache load failed");
  }
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
    icon: L.divIcon({
      html:`<div class="custom-pin" style="background:${pinType.color};"></div>`,
      iconSize:[10,10],
      iconAnchor:[5,5],
      className: "custom-marker"
    })
  });

  marker.pinData = pin;
  markers.push(marker);

  const category = categories[pinType.category];
  if(category && category.visible && pinType.visible){
    marker.addTo(map);
  }

  // Tooltip for hover (static to pin, no popup interference)
  if(pin.comment){
    marker.bindTooltip(pin.comment, {
      permanent: false,
      direction: "top",
      offset: [0, -5],
      className: "pin-tooltip"
    });

    // Ensure tooltips still show reliably even while modifier keys are held (e.g., Ctrl delete mode)
    marker.on("mouseover", (ev)=>{
      const isDeleting = deleting || (ev && ev.originalEvent && ev.originalEvent.ctrlKey);
      if(!isDeleting) marker.openTooltip();
    });
    marker.on("mouseout", ()=> marker.closeTooltip());
}


  // Allow deleting pins even when the click is captured by the marker (Leaflet stops map click propagation)
  marker.on("click", (ev)=>{
    const isDeleting = deleting || (ev && ev.originalEvent && ev.originalEvent.ctrlKey);
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

    catHeader.querySelector(".category-toggle").onclick = ()=>{
      category.collapsed = !category.collapsed;
      saveToCache();
      renderCategories();
    };

    catHeader.querySelector(".category-eye").onclick = ()=>{
      category.visible = !category.visible;

      // Update all pins in this category
      markers.forEach(m=>{
        const pinType = pinTypes[m.pinData.type];
        if(pinType && pinType.category === catName){
          if(category.visible && pinType.visible){
            m.addTo(map);
          } else {
            map.removeLayer(m);
          }
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
          eye.textContent = pinType.visible ? "👁" : "🚫";
          eye.onclick = ()=>{
            pinType.visible = !pinType.visible;
            markers
              .filter(m=>m.pinData.type===typeName)
              .forEach(m=>{
                const cat = categories[pinType.category];
                if(cat && cat.visible && pinType.visible){
                  m.addTo(map);
                } else {
                  map.removeLayer(m);
                }
              });
            saveToCache();
            renderCategories();
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

document.getElementById("importPins").onchange = e=>{
  const reader = new FileReader();
  reader.onload = ev=>{
    const data = JSON.parse(ev.target.result);

    markers.forEach(m=>map.removeLayer(m));
    markers = [];
    categories = data.categories || {};
    pinTypes = data.pinTypes || {};
    activePinType = null;

    data.pins.forEach(p=>addPin(p));
    saveToCache();
    renderCategories();
    renderCategorySelect();
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

requestAnimationFrame(() => requestAnimationFrame(hideBootOverlay));
