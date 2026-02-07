// ================================
// CONFIG
// ================================
const IMAGE_WIDTH = 8192;
const IMAGE_HEIGHT = 8192;
const bounds = [[0,0],[IMAGE_HEIGHT, IMAGE_WIDTH]];

let pinTypes = {};
let activePinType = null;
let markers = [];

const STORAGE_KEY = "gta_map_cache_v2";

const defaultColors = [
  "#e74c3c","#2ecc71","#3498db",
  "#f39c12","#9b59b6","#1abc9c",
  "#e84393","#6c5ce7"
];

// ================================
// MAP SETUP
// ================================
const map = L.map('map', {
  crs: L.CRS.Simple,
  zoomSnap: 0.1,
  zoomAnimation: false,
  inertia: false,
  attributionControl: false,
  zoomControl: false
});

L.imageOverlay('gtav-map.png', bounds).addTo(map);

// 🔹 horizontal-fit zoom
const container = document.getElementById('map');
const fitZoom = Math.log2(container.clientWidth / IMAGE_WIDTH);
map.setView([IMAGE_HEIGHT/2, IMAGE_WIDTH/2], fitZoom - 0.3);

map.options.minZoom = fitZoom - 0.3;
map.options.maxZoom = fitZoom + 3;

map.setMaxBounds([[0,-500],[IMAGE_HEIGHT, IMAGE_WIDTH+500]]);
map.on('drag', ()=>map.panInsideBounds(map.getBounds(), {animate:false}));

// ================================
// STORAGE
// ================================
function saveCache(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    pinTypes,
    pins: markers.map(m=>m.pinData)
  }));
}

function loadCache(){
  const raw = localStorage.getItem(STORAGE_KEY);
  if(!raw) return;
  try{
    const data = JSON.parse(raw);
    pinTypes = data.pinTypes || {};
    data.pins.forEach(p=>addPin(p));
    renderPinTypes();
  }catch{}
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
  const el = document.createElement("div");
  el.style.width = "8px";
  el.style.height = "8px";
  el.style.borderRadius = "50%";
  el.style.background = pinTypes[pin.type].color;
  el.style.border = "1px solid #000";

  // hover text
  if(pin.title){
    el.title = pin.title;
  }

  const marker = L.marker([pin.y, pin.x], {
    icon: L.divIcon({
      html: el,
      iconSize: [8,8],
      iconAnchor: [4,4]
    })
  });

  marker.pinData = pin;
  marker.addTo(map);
  markers.push(marker);
  saveCache();
  return marker;
}

// ================================
// INPUT MODES
// ================================
let placing = false;
let deleting = false;

window.addEventListener('keydown', e=>{
  if(e.key === "Shift"){
    placing = true;
    map.getContainer().classList.add('place-pin-cursor');
  }
  if(e.key === "Control"){
    deleting = true;
    map.getContainer().style.cursor = "not-allowed";
  }
});

window.addEventListener('keyup', e=>{
  if(e.key === "Shift"){
    placing = false;
    map.getContainer().classList.remove('place-pin-cursor');
  }
  if(e.key === "Control"){
    deleting = false;
    map.getContainer().style.cursor = "";
  }
});

// ================================
// MAP CLICK
// ================================
map.on('click', e=>{
  const click = map.latLngToContainerPoint(e.latlng);

  // DELETE MODE
  if(deleting){
    for(const m of markers){
      const p = map.latLngToContainerPoint(m.getLatLng());
      if(p.distanceTo(click) < 10){
        if(confirm("Delete this pin?")){
          map.removeLayer(m);
          markers = markers.filter(x=>x!==m);
          saveCache();
        }
        return;
      }
    }
    return;
  }

  // PLACE MODE
  if(!placing || !activePinType) return;

  const title = prompt("Pin text (optional):");
  addPin({
    x:e.latlng.lng,
    y:e.latlng.lat,
    title:title||"",
    type:activePinType
  });

  placing = false;
  map.getContainer().classList.remove('place-pin-cursor');
});

// ================================
// PIN TYPES UI (unchanged for now)
// ================================
function renderPinTypes(){
  const c = document.getElementById("pinTypesContainer");
  c.innerHTML = "";

  for(const name in pinTypes){
    const row = document.createElement("div");

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "active";
    radio.checked = activePinType === name;
    radio.onchange = ()=>activePinType = name;

    const label = document.createElement("label");
    label.innerHTML = `
      <span style="display:inline-block;width:14px;height:14px;
      background:${pinTypes[name].color};
      border:1px solid #000;margin-right:6px;"></span>${name}
    `;

    row.append(radio,label);
    c.appendChild(row);
  }
}

// ================================
// ADD TYPE
// ================================
document.getElementById("addPinType").onclick = ()=>{
  const name = newPinName.value.trim();
  if(!name) return;
  pinTypes[name] = { color: newPinColor.value || nextColor() };
  activePinType = name;
  newPinName.value = "";
  newPinColor.value = nextColor();
  saveCache();
  renderPinTypes();
};

newPinColor.value = nextColor();

// ================================
// INIT
// ================================
loadCache();
renderPinTypes();
