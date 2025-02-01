import aiofiles
import json

async def get_json_file(file_path):
    try:
        async with aiofiles.open(file_path, mode="r") as file:
            content = await file.read()
            data = json.loads(content)
        return data
    except FileNotFoundError:
        print(f"Erreur : {file_path} not found.")
        return None
    except json.JSONDecodeError:
        print(f"Error : {file_path} is an invalid JSON.")
        return None
    
async def save_json_file(file_path, data):
    try:
        async with aiofiles.open(file_path, mode="w") as file:
            # Convertir les données en JSON
            content = json.dumps(data, indent=4)
            # Écrire le contenu dans le fichier
            await file.write(content)
    except json.JSONDecodeError:
        print(f"Erreur : {file_path} is an invalid JSON.")