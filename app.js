// --- 1. Definición de URLs y Áreas Geográficas ---

// URLs de datos en tiempo real de Renfe (Necesita proxy CORS)
const PROXY = "https://corsproxy.io/?"; 
const RENFE_VP_URL = "https://gtfsrt.renfe.com/vehicle_positions.json";
const RENFE_TU_URL = "https://gtfsrt.renfe.com/trip_updates.json";

const VP_URL = PROXY + encodeURIComponent(RENFE_VP_URL);
const TU_URL = PROXY + encodeURIComponent(RENFE_TU_URL);

// URLs de datos estáticos (se asume que están en el mismo root del repo)
const ROUTES_URL = 'gtfs/routes.txt';
const TRIPS_URL = 'gtfs/trips.txt';

// Coordenadas Bounding Box (Comunidad Valenciana)
const VALENCIA_BBOX = {
    minLat: 37.95, maxLat: 40.80, minLon: -1.80, maxLon: 0.70
};

let trenesCV = {};
let trainMarkersGroup = L.layerGroup();
let MapRoutes = {}; 
let MapTrips = {};

// --- 2. Mapeos de Datos Estáticos GTFS (Carga desde el Repositorio) ---

function parseCSV(csvString) {
    const lines = csvString.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
        const values = line.split(',').map(v => v.trim());
        let obj = {};
        headers.forEach((header, i) => {
            if (values[i] !== undefined) {
                 obj[header] = values[i];
            }
        });
        return obj;
    }).filter(obj => Object.keys(obj).length > 0);
}

/**
 * Descarga y procesa los archivos GTFS estáticos del repositorio.
 */
async function loadStaticData() {
    console.log("Cargando datos estáticos del repositorio...");
    try {
        const [routesResponse, tripsResponse] = await Promise.all([
            fetch(ROUTES_URL),
            fetch(TRIPS_URL)
        ]);

        if (!routesResponse.ok || !tripsResponse.ok) {
            // Este error puede ocurrir si los archivos routes.txt y trips.txt NO han sido subidos al root
            throw new Error("No se pudieron descargar los archivos GTFS (routes.txt o trips.txt). Asegúrese de que existen en la raíz del repositorio.");
        }

        const routesCSV = await routesResponse.text();
        const tripsCSV = await tripsResponse.text();

        // Procesar routes.txt
        const routesData = parseCSV(routesCSV);
        routesData.forEach(route => {
            MapRoutes[route.route_id] = {
                short_name: route.route_short_name,
                long_name: route.route_long_name
            };
        });

        // Procesar trips.txt
        const tripsData = parseCSV(tripsCSV);
        tripsData.forEach(trip => {
            const headsign = trip.trip_headsign ? trip.trip_headsign.trim() : 'Destino Desconocido';
            MapTrips[trip.trip_id] = {
                route_id: trip.route_id,
                headsign: headsign
            };
        });
        
        console.log(`Datos estáticos cargados. Rutas: ${Object.keys(MapRoutes).length}, Viajes: ${Object.keys(MapTrips).length}`);

    } catch (error) {
        console.error("Error crítico al cargar datos GTFS estáticos:", error);
        if (window.updateInterval) clearInterval(window.updateInterval);
        document.getElementById('mapid').innerHTML = '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:red; font-size:1.2em; text-align:center; padding: 20px; background: white; border-radius: 5px;">ERROR: No se pudieron cargar los datos estáticos. Asegúrese de que los archivos TXT están en el repositorio y la URL es correcta.</div>';
    }
}


// --- 3. Inicialización del Mapa (Igual que antes) ---

const map = L.map('mapid').setView([39.4699, -0.3774], 10);
trainMarkersGroup.addTo(map);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: 'Datos de mapa &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

const trainIcon = L.icon({
    iconUrl: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="#E30013" width="24px" height="24px"><path d="M0 0h24v24H0z" fill="none"/><path d="M12 2c-4.42 0-8 3.58-8 8v8h16v-8c0-4.42-3.58-8-8-8zm-1 16H8v-2h3v2zm4 0h-3v-2h3v2zm3-4H6v-2h12v2zm-1-4H7V8h10v2z"/></svg>'),
    iconSize: [24, 24], 
    iconAnchor: [12, 12], 
    popupAnchor: [0, -12] 
});

// --- 4. Funciones de Procesamiento de Datos (Igual que antes) ---

function isValenciaTrain(lat, lon) {
    return lat >= VALENCIA_BBOX.minLat && lat <= VALENCIA_BBOX.maxLat &&
           lon >= VALENCIA_BBOX.minLon && lon <= VALENCIA_BBOX.maxLon;
}

function processTripUpdates(entities) {
    entities.forEach(entity => {
        const tripUpdate = entity.tripUpdate;
        const tripId = tripUpdate.trip.tripId;
        const delay = tripUpdate.delay || 0;

        if (trenesCV[tripId]) {
            trenesCV[tripId].delay = delay;
        }
    });
}

function processVehiclePositions(entities) {
    let activeTripIds = new Set();
    entities.forEach(entity => {
        const vehicle = entity.vehicle;
        
        if (!vehicle || !vehicle.position || !vehicle.trip || !vehicle.trip.tripId) {
            return;
        }
        const tripId = vehicle.trip.tripId;
        const lat = vehicle.position.latitude;
        const lon = vehicle.position.longitude;
        
        if (!isValenciaTrain(lat, lon)) {
            return;
        }

        const tripInfo = MapTrips[tripId];
        if (!tripInfo) {
            return; 
        }
        const routeInfo = MapRoutes[tripInfo.route_id];
        const route_short_name = routeInfo ? routeInfo.short_name : 'Línea Desconocida';
        const destination = tripInfo.headsign;

        activeTripIds.add(tripId);
        
        if (!trenesCV[tripId]) {
            trenesCV[tripId] = { lat, lon, delay: 0, marker: null, route: route_short_name, destination: destination };
            updateMarker(tripId);
        } else {
            trenesCV[tripId].lat = lat;
            trenesCV[tripId].lon = lon;
            updateMarker(tripId);
        }
    });

    Object.keys(trenesCV).forEach(tripId => {
        if (!activeTripIds.has(tripId)) {
            if (trenesCV[tripId].marker) {
                trainMarkersGroup.removeLayer(trenesCV[tripId].marker);
            }
            delete trenesCV[tripId];
        }
    });
}

function updateMarker(tripId) {
    const data = trenesCV[tripId];
    const delayMinutes = Math.round(data.delay / 60);
    const delayStyle = delayMinutes > 0 ? 'color:red;' : 'color:green;';
    const delayText = delayMinutes > 0 ? `<span style="${delayStyle}">+${delayMinutes} min de retraso</span>` : `<span style="${delayStyle}">A tiempo</span>`;

    const popupContent = `
        <strong>Línea:</strong> ${data.route}<br>
        <strong>Destino:</strong> ${data.destination}<br>
        <strong>Retraso:</strong> ${delayText}
    `;

    if (data.marker) {
        data.marker.setLatLng([data.lat, data.lon]);
        data.marker.setPopupContent(popupContent);
    } else {
        const marker = L.marker([data.lat, data.lon], { icon: trainIcon })
            .bindPopup(popupContent, {closeButton: false, autoClose: false});

        data.marker = marker;
        trainMarkersGroup.addLayer(marker);
    }
}

// --- 5. Función de Consulta y Actualización Principal (Igual que antes) ---

async function fetchAndUpdateData() {
    if (Object.keys(MapTrips).length === 0) {
        return;
    }
    console.log("Actualizando datos en tiempo real...");
    
    try {
        const tu_response = await fetch(TU_URL);
        const tu_data = await tu_response.json();
        processTripUpdates(tu_data.entity);

        const vp_response = await fetch(VP_URL);
        const vp_data = await vp_response.json();
        processVehiclePositions(vp_data.entity);
        
        console.log(`Trenes visibles: ${Object.keys(trenesCV).length}`);

    } catch (error) {
        console.error("Error al obtener o procesar datos en tiempo real (CORS/Renfe):", error);
    }
}

// --- 6. Ejecución ---

loadStaticData().then(() => {
    fetchAndUpdateData();
    window.updateInterval = setInterval(fetchAndUpdateData, 15000);
});