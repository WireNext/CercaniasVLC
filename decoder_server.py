import os
import time
import requests
from flask import Flask, jsonify
from flask_cors import CORS
from google.transit import gtfs_realtime_pb2
from google.protobuf.json_format import MessageToDict

# --- CONFIGURACIÓN DE RENFE ---
RENFE_VP_URL = "https://gtfsrt.renfe.com/vehicle_positions.pb"
RENFE_TU_URL = "https://gtfsrt.renfe.com/trip_updates.pb"

# --- CONFIGURACIÓN DE FLASK/CACHE ---
app = Flask(__name__)
# Permitir acceso desde cualquier origen (CORS)
CORS(app) 
CACHE = {}
# Tiempo de validez de la caché (25 segundos)
CACHE_TIMEOUT = 25 

def fetch_and_decode_gtfsrt(url, cache_key):
    """
    Descarga el archivo .pb, lo decodifica y lo almacena en caché.
    """
    current_time = time.time()
    
    # 1. Verificar la caché
    if cache_key in CACHE and (current_time - CACHE[cache_key]['timestamp']) < CACHE_TIMEOUT:
        return CACHE[cache_key]['data']

    # 2. Descargar el archivo binario
    try:
        # Añadir un User-Agent es una buena práctica para APIs públicas
        headers = {'User-Agent': 'RenfeGTFSRT-Decoder/1.0'} 
        response = requests.get(url, timeout=15, headers=headers)
        response.raise_for_status() 
    
    except requests.exceptions.RequestException as e:
        print(f"❌ Error al descargar {url}: {e}")
        # Si falla la descarga, intentar devolver la versión cacheada si existe
        if cache_key in CACHE:
             return CACHE[cache_key]['data']
        
        # SOLUCIÓN DE FALLO: Devolvemos 200 OK con JSON vacío para que el frontend no falle
        print("⚠️ Advertencia: Error en descarga y caché vacía. Devolviendo JSON vacío.")
        return {"header": {"timestamp": int(time.time())}, "entity": []}


    # 3. Decodificar Protocol Buffers
    try:
        feed = gtfs_realtime_pb2.FeedMessage()
        feed.ParseFromString(response.content)
        
        # 4. Convertir el objeto FeedMessage a un diccionario (JSON)
        data_dict = {
            # CORRECCIÓN CLAVE: 'names' se cambia a 'name' (singular)
            "header": MessageToDict(feed.header, preserving_proto_field_name=True), 
            "entity": []
        }
        
        for entity in feed.entity:
            entity_dict = {}
            if entity.id:
                entity_dict['id'] = entity.id

            if entity.vehicle.ByteSize() > 0:
                # CORRECCIÓN CLAVE: 'names' se cambia a 'name' (singular)
                entity_dict['vehicle'] = MessageToDict(entity.vehicle, preserving_proto_field_name=True)
            
            if entity.trip_update.ByteSize() > 0:
                # CORRECCIÓN CLAVE: 'names' se cambia a 'name' (singular)
                entity_dict['tripUpdate'] = MessageToDict(entity.trip_update, preserving_proto_field_name=True)

            if entity_dict:
                 data_dict['entity'].append(entity_dict)
        
        # 5. Actualizar la caché
        CACHE[cache_key] = {'data': data_dict, 'timestamp': current_time}
        return data_dict

    except Exception as e:
        print(f"❌ Error al decodificar GTFS-RT: {e}")
        # Si falla la decodificación, intentar devolver la versión cacheada si existe
        if cache_key in CACHE:
             return CACHE[cache_key]['data']
        
        # SOLUCIÓN DE FALLO: Devolvemos 200 OK con JSON vacío para que el frontend no falle
        print("⚠️ Advertencia: Error en decodificación y caché vacía. Devolviendo JSON vacío.")
        return {"header": {"timestamp": int(time.time())}, "entity": []}


# --- RUTAS FLASK ---
@app.route('/api/vehicle_positions', methods=['GET'])
def get_vehicle_positions():
    data = fetch_and_decode_gtfsrt(RENFE_VP_URL, 'vp_data')
    # Si devuelve un diccionario, lo devuelve como JSON con código 200
    return jsonify(data)

@app.route('/api/trip_updates', methods=['GET'])
def get_trip_updates():
    data = fetch_and_decode_gtfsrt(RENFE_TU_URL, 'tu_data')
    # Si devuelve un diccionario, lo devuelve como JSON con código 200
    return jsonify(data)

@app.route('/')
def home():
    return "Renfe GTFS-RT Decoder Activo."

# Código de ejecución local simplificado. Render usará gunicorn.
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)