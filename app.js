// --- 1. Definición de URLs, Tiempos y Áreas Geográficas ---

// 🎯 CAMBIO CLAVE: Usamos la URL de tu servidor decodificador alojado en Render.
const RENDER_BASE_URL = "https://cercaniasvlc.onrender.com"; 

const VP_URL = RENDER_BASE_URL + "/api/vehicle_positions";
const TU_URL = RENDER_BASE_URL + "/api/trip_updates";

// URLs de datos estáticos (APUNTANDO A LA CARPETA GTFS)
const ROUTES_URL = 'gtfs/routes.txt';
const TRIPS_URL = 'gtfs/trips.txt';
const STOPS_URL = 'gtfs/stops.txt'; 

// Coordenadas Bounding Box (Comunidad Valenciana + Murcia)
const VALENCIA_BBOX = {
    minLat: 37.95, maxLat: 40.80, minLon: -1.80, maxLon: 0.70
};

// CONSTANTE PARA ANIMACIÓN FLUIDA (30 segundos entre updates)
const ANIMATION_DURATION_MS = 30000; 

let trenesCV = {};
let trainMarkersGroup = L.layerGroup();
let MapRoutes = {}; 
let MapTrips = {};
let MapStops = {}; 


// --- 2. Mapeos de Datos Estáticos GTFS (Carga y Parseo) ---

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
 * Descarga y procesa los archivos GTFS estáticos.
 */
async function loadStaticData() {
    console.log("Cargando datos estáticos del repositorio...");
    try {
        const [routesResponse, tripsResponse, stopsResponse] = await Promise.all([
            fetch(ROUTES_URL),
            fetch(TRIPS_URL),
            fetch(STOPS_URL) 
        ]);

        if (!routesResponse.ok || !tripsResponse.ok || !stopsResponse.ok) {
            throw new Error(`No se pudieron descargar los archivos GTFS. Asegúrese de que existen en la carpeta gtfs/`);
        }

        const routesCSV = await routesResponse.text();
        const tripsCSV = await tripsResponse.text();
        const stopsCSV = await stopsResponse.text();

        parseCSV(routesCSV).forEach(route => {
            MapRoutes[route.route_id] = { short_name: route.route_short_name, long_name: route.route_long_name };
        });

        // Usamos la limpieza de ID para el mapeo estático también
        parseCSV(tripsCSV).forEach(trip => {
            const headsign = trip.trip_headsign ? trip.trip_headsign.trim() : 'Destino Desconocido';
            if(trip.trip_id) {
                MapTrips[cleanTripId(trip.trip_id)] = { route_id: trip.route_id, headsign: headsign };
            }
        });
        
        parseCSV(stopsCSV).forEach(stop => {
            if(stop.stop_id && stop.stop_name) {
                MapStops[stop.stop_id.trim()] = { stop_name: stop.stop_name.trim() };
            }
        });

        console.log(`Datos estáticos cargados. Rutas: ${Object.keys(MapRoutes).length}, Viajes: ${Object.keys(MapTrips).length}, Paradas: ${Object.keys(MapStops).length}`);

    } catch (error) {
        console.error("Error crítico al cargar datos GTFS estáticos:", error);
        if (window.updateInterval) clearInterval(window.updateInterval);
        document.getElementById('mapid').innerHTML = '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:red; font-size:1.2em; text-align:center; padding: 20px; background: white; border-radius: 5px;">ERROR: No se pudieron cargar los datos estáticos. Asegúrese de que los archivos TXT están en la carpeta gtfs/.</div>';
    }
}


// --- 3. Inicialización del Mapa ---

const map = L.map('mapid').setView([38.9, -0.9], 9); 
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

// --- 4. Funciones de Procesamiento de Datos ---

function isValenciaTrain(lat, lon) {
   const bbox = VALENCIA_BBOX;
   // ✅ Filtro Geográfico REACTIVADO
   return lat >= bbox.minLat && lat <= bbox.maxLat && 
          lon >= bbox.minLon && lon <= bbox.maxLon;
}

/**
 * Limpia el tripId.
 */
function cleanTripId(tripId) {
    if (!tripId) return null;
    return tripId.trim(); 
}

function processTripUpdates(entities) {
    if (!Array.isArray(entities)) return;
    
    entities.forEach(entity => {
        const tripUpdate = entity.tripUpdate;
        if (!tripUpdate) return; 

        // 🛑 CORRECCIÓN DE SEGURIDAD (Previene el error 'trim' y el log de 90 errores)
        if (!tripUpdate.trip || !tripUpdate.trip.tripId) {
            console.warn("Entidad TripUpdate sin información de viaje completa. Ignorando.");
            return;
        }

        const tripId = cleanTripId(tripUpdate.trip.tripId); 
        const delay = tripUpdate.delay || 0; 

        if (trenesCV[tripId]) {
            trenesCV[tripId].delay = delay;
        }
    });
}

function processVehiclePositions(entities) {
    if (!Array.isArray(entities)) return;

    let activeTripIds = new Set();
    entities.forEach(entity => {
        const vehicle = entity.vehicle;
        
        if (!vehicle || !vehicle.position || !vehicle.trip || !vehicle.trip.tripId) {
            return;
        }
        
        const tripId = cleanTripId(vehicle.trip.tripId); 
        const lat = vehicle.position.latitude;
        const lon = vehicle.position.longitude;
        
        // --- APLICAR FILTRO GEOGRÁFICO ---
        if (!isValenciaTrain(lat, lon)) {
            return;
        }
        
        const tripInfo = MapTrips[tripId];
        if (!tripInfo) {
            // console.warn(`Tren IGNORADO (tripId no encontrado en trips.txt): ${tripId}.`);
            return; 
        }
        
        // --- EXTRACCIÓN DE PLATAFORMA y STOP ID ---
        let platform_code = 'N/A';
        let current_stop_id = vehicle.stopId ? vehicle.stopId.trim() : null; 
        
        if (vehicle.vehicle && vehicle.vehicle.label) {
            const match = vehicle.vehicle.label.match(/\((\d+)\)$/); 
            if (match && match[1]) {
                platform_code = match[1];
            }
        }
        // --------------------------------------------

        const routeInfo = MapRoutes[tripInfo.route_id];
        const route_short_name = routeInfo ? routeInfo.short_name : 'Línea Desconocida';
        const destination = tripInfo.headsign;

        activeTripIds.add(tripId);
        
        if (!trenesCV[tripId]) {
            // CREACIÓN INICIAL DEL TREN
            trenesCV[tripId] = { 
                lat, lon, 
                delay: 0, 
                marker: null, 
                route: route_short_name, 
                destination: destination,
                platform: platform_code,      
                current_stop_id: current_stop_id 
            };
            updateMarker(tripId); 

        } else {
            // ACTUALIZACIÓN DE POSICIÓN PARA ANIMACIÓN
            const oldLat = trenesCV[tripId].lat;
            const oldLon = trenesCV[tripId].lon;
            
            // 1. Guardar la nueva posición
            trenesCV[tripId].lat = lat;
            trenesCV[tripId].lon = lon;
            trenesCV[tripId].platform = platform_code;       
            trenesCV[tripId].current_stop_id = current_stop_id; 
            
            // 2. Llamar a la función de actualización con las posiciones para la animación
            updateMarker(tripId, [oldLat, oldLon], [lat, lon]);
        }
    });

    // Limpiar marcadores de trenes que ya no están en el feed
    Object.keys(trenesCV).forEach(tripId => {
        if (!activeTripIds.has(tripId)) {
            if (trenesCV[tripId].marker) {
                trainMarkersGroup.removeLayer(trenesCV[tripId].marker);
            }
            delete trenesCV[tripId];
        }
    });
}

function updateMarker(tripId, oldPos, newPos) {
    const data = trenesCV[tripId];
    const delayMinutes = Math.round(data.delay / 60);
    const delayStyle = delayMinutes > 0 ? 'color:red;' : 'color:green;';
    const delayText = delayMinutes > 0 ? `<span style="${delayStyle}">+${delayMinutes} min de retraso</span>` : `<span style="${delayStyle}">A tiempo</span>`;

    // 1. Obtener el nombre legible de la parada
    let stopName = 'ID no reportada / En ruta';
    if (data.current_stop_id && MapStops[data.current_stop_id]) {
        stopName = MapStops[data.current_stop_id].stop_name;
    } else if (data.current_stop_id) {
        stopName = `ID ${data.current_stop_id} (Nombre no encontrado)`;
    }
    
    // 2. Contenido del popup
    const platformContent = data.platform !== 'N/A' 
        ? `<strong style="font-size: 1.1em; color: #007bff;">Vía ${data.platform}</strong>` 
        : 'N/A (En tránsito o vía no asignada)';

    const popupContent = `
        <strong>Línea:</strong> ${data.route}<br>
        <strong>Destino:</strong> ${data.destination}<br>
        ---<br>
        <strong>Parada Actual/Próxima:</strong> ${stopName}<br>
        <strong>Vía de Llegada:</strong> ${platformContent}<br>
        ---<br>
        <strong>Retraso:</strong> ${delayText}
    `;

    if (data.marker) {
        // --- LÓGICA DE MOVIMIENTO CON ANIMACIÓN (MovingMarker) ---
        if (oldPos && newPos && (oldPos[0] !== newPos[0] || oldPos[1] !== newPos[1])) {
             // Mueve el marcador de forma fluida a la nueva posición en 30 segundos
            data.marker.moveTo(newPos, ANIMATION_DURATION_MS);
        } else {
            // Si la posición no ha cambiado, actualizamos solo la posición/popup
            data.marker.setLatLng([data.lat, data.lon]);
        }
        data.marker.setPopupContent(popupContent);

    } else {
        // Crear el marcador como MovingMarker
        const marker = L.movingMarker([[data.lat, data.lon]], [ANIMATION_DURATION_MS], { icon: trainIcon, autostart: true })
            .bindPopup(popupContent, {closeButton: false, autoClose: false});

        data.marker = marker;
        trainMarkersGroup.addLayer(marker);
        marker.start(); // Inicia el MovingMarker
    }
}

// --- 5. Función de Consulta y Actualización Principal (Frecuencia 30s) ---

async function fetchAndUpdateData() {
    if (Object.keys(MapTrips).length === 0) {
        return;
    }
    console.log("Actualizando datos en tiempo real...");
    
    try {
        const tu_response = await fetch(TU_URL);
        const tu_data = await tu_response.json();
        if (tu_data && tu_data.entity) {
            processTripUpdates(tu_data.entity);
        }

        const vp_response = await fetch(VP_URL);
        const vp_data = await vp_response.json();
        if (vp_data && vp_data.entity) {
            processVehiclePositions(vp_data.entity);
        }
        
        console.log(`Trenes visibles: ${Object.keys(trenesCV).length}`);

    } catch (error) {
        console.error("Error al obtener o procesar datos en tiempo real (Backend caído o problema de red):", error);
    }
}

// --- 6. Ejecución ---

loadStaticData().then(() => {
    fetchAndUpdateData();
    // Ejecutar cada 30 segundos (30000 ms)
    window.updateInterval = setInterval(fetchAndUpdateData, 30000); 
});