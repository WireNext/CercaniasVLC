import requests
import zipfile
import io
import os

ZIP_URL = "https://ssl.renfe.com/ftransit/Fichero_CER_FOMENTO/fomento_transit.zip"
TARGET_DIR = "gtfs"

def download_and_extract_gtfs_modificado():
    """
    Descarga y extrae el archivo GTFS de Renfe, forzando 
    que los archivos queden directamente dentro de 'gtfs/'.
    """
    
    if not os.path.exists(TARGET_DIR):
        os.makedirs(TARGET_DIR)
        print(f"✅ Directorio creado: /{TARGET_DIR}")

    print(f"⬇️ Descargando ZIP de {ZIP_URL}...")
    try:
        response = requests.get(ZIP_URL, stream=True)
        response.raise_for_status() 

    except requests.exceptions.RequestException as e:
        print(f"❌ Error al descargar: {e}")
        return

    # 3. Procesar y extraer el contenido
    if response.status_code == 200:
        try:
            z = zipfile.ZipFile(io.BytesIO(response.content))
            
            # --- MODIFICACIÓN CLAVE AQUÍ ---
            
            file_count = 0
            for member in z.infolist():
                # Ignorar entradas que son directorios (terminan en /)
                if not member.is_dir():
                    # Obtener solo el nombre del archivo (base name), ignorando las carpetas internas
                    filename = os.path.basename(member.filename)
                    
                    # Ignorar cualquier archivo cuyo nombre esté vacío (por si acaso)
                    if not filename:
                        continue 
                    
                    # Definir la ruta de destino: gtfs/nombre_archivo.txt
                    target_path = os.path.join(TARGET_DIR, filename)
                    
                    # Leer y escribir el archivo
                    with open(target_path, "wb") as outfile:
                        outfile.write(z.read(member))
                    
                    file_count += 1
            
            print(f"🎉 Extracción completada. {file_count} archivos guardados en /{TARGET_DIR}")
            
        except zipfile.BadZipFile:
            print("❌ Error: El archivo descargado no es un ZIP válido.")
        except Exception as e:
            print(f"❌ Error durante la extracción: {e}")
    else:
        print(f"❌ Error al descargar: Código de estado {response.status_code}")

if __name__ == "__main__":
    download_and_extract_gtfs_modificado()