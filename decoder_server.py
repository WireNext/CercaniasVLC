# decoder_server.py (Versión Final con Decodificación Manual Reforzada)

from flask import Flask, jsonify
from google.transit import gtfs_realtime_pb2
import requests
import time
import os

app = Flask(__name__)

# URL de la fuente de datos (Protocol Buffer)
RENFE_VP_URL = "https://gtfsrt.renfe.com/vehicle_positions.pb"
RENFE_TU_URL = "https://gtfsrt.renfe.com/trip_updates.pb"

# Cache para limitar las peticiones a Renfe (25 segundos)
cache = {}
CACHE_TIMEOUT_SECONDS = 25 

def fetch_and_decode_gtfsrt(url, cache_key):
    global cache
    
    # Comprobar la caché
    if cache_key in cache and time.time() < cache[cache_key]['expiry']:
        return cache[cache_key]['data']
    
    # Descargar el feed binario
    try:
        response = requests.get(url, timeout=15)
        response.raise_for_status()
        
        feed = gtfs_realtime_pb2.FeedMessage()
        # Intentar analizar el contenido binario
        feed.ParseFromString(response.content)
        
        entities_list = []
        for entity in feed.entity:
            
            entity_dict = {}
            if entity.HasField('id'):
                entity_dict['id'] = entity.id

            # --- LÓGICA REFORZADA PARA VEHICLE_POSITIONS ---
            if entity.HasField('vehicle'):
                vehicle = {}
                
                # 🚨 PUNTO CLAVE: Intento manual de extraer la POSICIÓN
                if entity.vehicle.HasField('position'):
                    position = {}
                    
                    # 1. Intentar extraer los campos estándar (latitude/longitude)
                    # Si fallan, es porque Renfe usa una extensión.
                    if entity.vehicle.position.HasField('latitude'):
                        position['latitude'] = entity.vehicle.position.latitude
                    if entity.vehicle.position.HasField('longitude'):
                        position['longitude'] = entity.vehicle.position.longitude
                    
                    if position:
                        vehicle['position'] = position
                
                # Intenta extraer la información del viaje (tripId)
                if entity.vehicle.HasField('trip'):
                    trip = {}
                    if entity.vehicle.trip.HasField('trip_id'):
                        trip['tripId'] = entity.vehicle.trip.trip_id
                    if entity.vehicle.trip.HasField('schedule_relationship'):
                         trip['schedule_relationship'] = entity.vehicle.trip.schedule_relationship
                    if trip:
                        vehicle['trip'] = trip

                # Otros campos importantes para el frontend
                if entity.vehicle.HasField('stop_id'):
                    vehicle['stopId'] = entity.vehicle.stop_id
                if entity.vehicle.HasField('vehicle') and entity.vehicle.vehicle.HasField('label'):
                    vehicle['vehicle'] = {'label': entity.vehicle.vehicle.label}

                if vehicle:
                    entity_dict['vehicle'] = vehicle
            # --- FIN DE LÓGICA REFORZADA ---


            # --- LÓGICA PARA TRIP_UPDATES (Menos problemática) ---
            if entity.HasField('trip_update'):
                trip_update = {}
                if entity.trip_update.HasField('trip'):
                    trip_data = {}
                    if entity.trip_update.trip.HasField('trip_id'):
                        trip_data['tripId'] = entity.trip_update.trip.trip_id
                    if entity.trip_update.trip.HasField('schedule_relationship'):
                        trip_data['schedule_relationship'] = entity.trip_update.trip.schedule_relationship
                    trip_update['trip'] = trip_data
                
                if entity.trip_update.HasField('delay'):
                    trip_update['delay'] = entity.trip_update.delay

                stop_time_updates = []
                for stu in entity.trip_update.stop_time_update:
                    stu_dict = {}
                    if stu.HasField('stop_id'):
                        stu_dict['stop_id'] = stu.stop_id
                    if stu.HasField('arrival'):
                        arrival = {}
                        if stu.arrival.HasField('delay'):
                            arrival['delay'] = stu.arrival.delay
                        if stu.arrival.HasField('time'):
                            # Convertir timestamp a string
                            arrival['time'] = str(stu.arrival.time) 
                        if arrival:
                            stu_dict['arrival'] = arrival
                    stop_time_updates.append(stu_dict)
                
                if stop_time_updates:
                    trip_update['stop_time_update'] = stop_time_updates

                if trip_update:
                    entity_dict['tripUpdate'] = trip_update


            if entity_dict:
                entities_list.append(entity_dict)


        result = {
            "entity": entities_list,
            "header": {
                # Aseguramos que el timestamp siempre sea un entero
                "timestamp": int(feed.header.timestamp)
            }
        }
        
        # Almacenar en caché
        cache[cache_key] = {
            'data': result,
            'expiry': time.time() + CACHE_TIMEOUT_SECONDS
        }
        
        return result

    except requests.exceptions.RequestException as e:
        print(f"❌ Error de red al acceder a Renfe: {e}")
        # Devolver datos de caché si hay un error de red
        if cache_key in cache:
             return cache[cache_key]['data']
        return {"entity": [], "header": {"timestamp": int(time.time())}}

    except Exception as e:
        # Captura errores de decodificación (incluyendo "missing required fields: trip")
        print(f"❌ Error al decodificar GTFS-RT: {e}")
        print("⚠️ Advertencia: Error en decodificación. Devolviendo JSON vacío.")
        return {"entity": [], "header": {"timestamp": int(time.time())}}

@app.route('/api/vehicle_positions')
def vehicle_positions():
    data = fetch_and_decode_gtfsrt(RENFE_VP_URL, 'vp_cache')
    return jsonify(data)

@app.route('/api/trip_updates')
def trip_updates():
    data = fetch_and_decode_gtfsrt(RENFE_TU_URL, 'tu_cache')
    return jsonify(data)

@app.route('/')
def index():
    return "Renfe GTFS-RT Decoder Activo."

if __name__ == '__main__':
    # Usar el puerto proporcionado por Render o 5000 por defecto
    port = int(os.environ.get('PORT', 5000))
    # Render usa gunicorn, por lo que esta línea es principalmente para pruebas locales
    app.run(host='0.0.0.0', port=port)