// ================================
// CONFIG
// ================================
const IMAGE_WIDTH = 8192;
const IMAGE_HEIGHT = 8192;
const bounds = [[0,0],[IMAGE_HEIGHT, IMAGE_WIDTH]];

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
  crs: L.CRS.Simple,
  zoomSnap: 0.1,
  zoomAnimation: false,
  inertia: false,
  attributionControl: false,
  zoomControl: false
});

L.imageOverlay("gtav-map.png", bounds).addTo(map);

const container = document.getElementById("map");
const scaleX = container.clientWidth / IMAGE_WIDTH;
let fitZoom = Math.log2(scaleX);
let startZoom = fitZoom - 1.2; // More zoomed out on initial load

map.setView([IMAGE_HEIGHT/2, IMAGE_WIDTH/2], startZoom);
map.options.minZoom = startZoom;
map.options.maxZoom = startZoom + 3;

map.setMaxBounds([[0,-500],[IMAGE_HEIGHT, IMAGE_WIDTH+500]]);
map.on("drag", () => map.panInsideBounds(map.getBounds(), { animate:false }));

// ================================
// DOM
// ================================
const categoriesContainer = document.getElementById("categoriesContainer");
const categorySelectWrapper = document.getElementById("categorySelect");
const newCategoryName = document.getElementById("newCategoryName");
const newPinName = document.getElementById("newPinName");
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
  }

  saveToCache();
  return marker;
}

// ================================
// INPUT MODES
// ================================
let placing = false;
let deleting = false;

window.addEventListener("keydown", e=>{
  if(e.key === "Shift" && !placing){
    placing = true;
    map.getContainer().classList.add("place-pin-cursor");
  }
  if(e.key === "Control" && !deleting){
    deleting = true;
    map.getContainer().classList.add("delete-pin-cursor");
  }
});

window.addEventListener("keyup", e=>{
  if(e.key === "Shift"){
    placing = false;
    map.getContainer().classList.remove("place-pin-cursor");
  }
  if(e.key === "Control"){
    deleting = false;
    map.getContainer().classList.remove("delete-pin-cursor");
  }
});

// ================================
// MAP CLICK
// ================================
map.on("click", e=>{
  const clickPoint = map.latLngToContainerPoint(e.latlng);

  // DELETE MODE (CTRL) - close tooltips to prevent interference
  if(deleting){
    for(const m of markers){
      const p = map.latLngToContainerPoint(m.getLatLng());
      if(p.distanceTo(clickPoint) < 12){
        m.closeTooltip(); // Close tooltip before deletion
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
  if(!placing) return;

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
  map.getContainer().classList.remove("place-pin-cursor");
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
      <button class="category-delete" data-category="${catName}">×</button>
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
        emptyMsg.textContent = "No pin types yet";
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
          label.innerHTML = `
            <span class="pin-color-swatch" style="background:${pinType.color};"></span>
            ${typeName}
          `;

          const color = document.createElement("input");
          color.type = "color";
          color.value = pinType.color;
          color.className = "pin-color-picker";
          color.oninput = ()=>{
            pinType.color = color.value;
            markers.filter(m=>m.pinData.type===typeName)
              .forEach(m=>m._icon.querySelector(".custom-pin").style.background=color.value);
            saveToCache();
            renderCategories();
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

          row.append(eye, radio, label, color, del);
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
document.getElementById("addCategory").onclick = ()=>{
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
document.getElementById("addPinType").onclick = ()=>{
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
document.getElementById("clearPins").onclick = ()=>{
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
