// --- 1. Definición de URLs y Áreas Geográficas ---

// URLs de datos en tiempo real de Renfe (Necesita proxy CORS)
const PROXY = "https://corsproxy.io/?"; 
const RENFE_VP_URL = "https://gtfsrt.renfe.com/vehicle_positions.json";
const RENFE_TU_URL = "https://gtfsrt.renfe.com/trip_updates.json";

const VP_URL = PROXY + encodeURIComponent(RENFE_VP_URL);
const TU_URL = PROXY + encodeURIComponent(RENFE_TU_URL);

// URLs de datos estáticos (APUNTANDO A LA CARPETA GTFS)
const ROUTES_URL = 'gtfs/routes.txt';
const TRIPS_URL = 'gtfs/trips.txt';
const STOPS_URL = 'gtfs/stops.txt'; // <-- ¡NUEVO!

// Coordenadas Bounding Box (Comunidad Valenciana)
const VALENCIA_BBOX = {
    minLat: 37.95, maxLat: 40.80, minLon: -1.80, maxLon: 0.70
};

let trenesCV = {};
let trainMarkersGroup = L.layerGroup();
let MapRoutes = {}; 
let MapTrips = {};
let MapStops = {}; // <-- ¡NUEVO! Objeto para mapear stop_id a stop_name

// --- 2. Mapeos de Datos Estáticos GTFS (Carga desde el Repositorio) ---

function parseCSV(csvString) {
    const lines = csvString.trim().split(/\r?\n/);
    if (lines.length <= 1) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    
    return lines.slice(1).map(line => {
        // Manejo de valores con comas dentro de comillas (aunque aquí se asume CSV simple)
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
        const [routesResponse, tripsResponse, stopsResponse] = await Promise.all([ // <-- Añadido stopsResponse
            fetch(ROUTES_URL),
            fetch(TRIPS_URL),
            fetch(STOPS_URL) // <-- Cargar stops.txt
        ]);

        if (!routesResponse.ok || !tripsResponse.ok || !stopsResponse.ok) {
            throw new Error(`No se pudieron descargar los archivos GTFS. Asegúrese de que existen en la carpeta gtfs/`);
        }

        const routesCSV = await routesResponse.text();
        const tripsCSV = await tripsResponse.text();
        const stopsCSV = await stopsResponse.text(); // <-- Contenido stops.txt

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
            
            if(trip.trip_id) {
                MapTrips[trip.trip_id.trim()] = { 
                    route_id: trip.route_id,
                    headsign: headsign
                };
            }
        });

        // Procesar stops.txt <-- ¡NUEVO BLOQUE!
        const stopsData = parseCSV(stopsCSV);
        stopsData.forEach(stop => {
            // Se asume que el stop_id y stop_name son las primeras columnas.
            if(stop.stop_id && stop.stop_name) {
                // Mapear ID (limpia) al nombre (limpio)
                MapStops[stop.stop_id.trim()] = {
                    stop_name: stop.stop_name.trim()
                };
            }
        });
        
        console.log(`Datos estáticos cargados. Rutas: ${Object.keys(MapRoutes).length}, Viajes: ${Object.keys(MapTrips).length}, Paradas: ${Object.keys(MapStops).length}`);

    } catch (error) {
        console.error("Error crítico al cargar datos GTFS estáticos:", error);
        if (window.updateInterval) clearInterval(window.updateInterval);
        document.getElementById('mapid').innerHTML = '<div style="position:absolute; top:50%; left:50%; transform:translate(-50%, -50%); color:red; font-size:1.2em; text-align:center; padding: 20px; background: white; border-radius: 5px;">ERROR: No se pudieron cargar los datos estáticos. Asegúrese de que los archivos TXT están en la carpeta gtfs/.</div>';
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

// --- 4. Funciones de Procesamiento de Datos (Con extracción de Plataforma y Nombre de Parada) ---

function isValenciaTrain(lat, lon) {
   // Filtro geográfico desactivado (puedes activarlo si solo quieres trenes CV)
   return true;
}

function processTripUpdates(entities) {
    entities.forEach(entity => {
        const tripUpdate = entity.tripUpdate;
        const tripId = tripUpdate.trip.tripId.trim(); 
        const delay = tripUpdate.delay || 0;
        
        // Solo actualizamos el retraso.
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
        
        const tripId = vehicle.trip.tripId.trim(); 
        const lat = vehicle.position.latitude;
        const lon = vehicle.position.longitude;
        
        if (!isValenciaTrain(lat, lon)) {
            return;
        }

        const tripInfo = MapTrips[tripId];
        if (!tripInfo) {
            // console.warn(`Tren IGNORADO...`);
            return; 
        }
        
        // --- LÓGICA DE EXTRACCIÓN DE PLATAFORMA ---
        let platform_code = 'N/A';
        let current_stop_id = vehicle.stopId ? vehicle.stopId.trim() : null; // La ID de la parada actual
        
        // El campo vehicle.vehicle.label contiene el código de plataforma ej: "C1-23562-PLATF.(2)"
        if (vehicle.vehicle && vehicle.vehicle.label) {
            // Regex para encontrar el número entre paréntesis al final, ej: (2) -> "2"
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
            trenesCV[tripId].lat = lat;
            trenesCV[tripId].lon = lon;
            trenesCV[tripId].platform = platform_code;       
            trenesCV[tripId].current_stop_id = current_stop_id; 
            console.log(`POSICIÓN RECIBIDA: Tren ${tripId}: Lat ${lat}, Lon ${lon}`);             
            trenesCV[tripId].lat = lat;
            trenesCV[tripId].lon = lon;
            trenesCV[tripId].platform = platform_code;       
            trenesCV[tripId].current_stop_id = current_stop_id;
            updateMarker(tripId);
        }
    });

    // Limpiar marcadores de trenes que ya no están reportando posición
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

    // 1. Obtener el nombre legible de la parada
    let stopName = 'ID no reportada / En ruta';
    if (data.current_stop_id && MapStops[data.current_stop_id]) {
        stopName = MapStops[data.current_stop_id].stop_name;
    } else if (data.current_stop_id) {
        // Si el ID se reporta pero no está en nuestro stops.txt (raro), mostramos el ID
        stopName = `ID ${data.current_stop_id} (Nombre no encontrado)`;
    }
    
    // 2. Determinar qué mostrar para la plataforma
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
        data.marker.setLatLng([data.lat, data.lon]);
        data.marker.setPopupContent(popupContent);
    } else {
        const marker = L.marker([data.lat, data.lon], { icon: trainIcon })
            .bindPopup(popupContent, {closeButton: false, autoClose: false});

        data.marker = marker;
        trainMarkersGroup.addLayer(marker);
    }
}

// --- 5. Función de Consulta y Actualización Principal (Frecuencia 15s) ---

async function fetchAndUpdateData() {
    if (Object.keys(MapTrips).length === 0) {
        return;
    }
    console.log("Actualizando datos en tiempo real...");
    
    try {
        // Fetch para Trip Updates (Retrasos)
        const tu_response = await fetch(TU_URL);
        const tu_data = await tu_response.json();
        processTripUpdates(tu_data.entity);

        // Fetch para Vehicle Positions (Posición GPS, Parada, Vía)
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
    // Ejecutar cada 15 segundos (15000 ms) para mantener la actualización
    window.updateInterval = setInterval(fetchAndUpdateData, 15000); 
});