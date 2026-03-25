import os
import piexif
from PIL import Image
import random

# Delhi area coordinates
DELHI_LAT = 28.7041
DELHI_LON = 77.1025
LAT_RANGE = 0.5
LON_RANGE = 0.5

def decimal_to_dms(decimal):
    is_negative = decimal < 0
    decimal = abs(decimal)
    degrees = int(decimal)
    minutes_decimal = (decimal - degrees) * 60
    minutes = int(minutes_decimal)
    seconds = (minutes_decimal - minutes) * 60
    return ((degrees, 1), (minutes, 1), (int(seconds * 10), 10))

def add_gps_to_image(image_path):
    try:
        lat = DELHI_LAT + random.uniform(-LAT_RANGE, LAT_RANGE)
        lon = DELHI_LON + random.uniform(-LON_RANGE, LON_RANGE)
        
        lat_dms = decimal_to_dms(lat)
        lon_dms = decimal_to_dms(lon)
        
        try:
            exif_dict = piexif.load(image_path)
        except:
            exif_dict = {"0th": {}, "Exif": {}, "1st": {}, "GPS": {}, "Interop": {}}
        
        gps_ifd = {
            piexif.GPSIFD.GPSLatitudeRef: b"N" if lat >= 0 else b"S",
            piexif.GPSIFD.GPSLatitude: lat_dms,
            piexif.GPSIFD.GPSLongitudeRef: b"E" if lon >= 0 else b"W",
            piexif.GPSIFD.GPSLongitude: lon_dms,
        }
        exif_dict["GPS"] = gps_ifd
        
        exif_bytes = piexif.dump(exif_dict)
        img = Image.open(image_path)
        img.save(image_path, exif=exif_bytes)
        return True
    except Exception as e:
        print(f"Error processing {image_path}: {e}")
        return False

# Dataset 1
ds1_path = r'd:\dl+nlp\archive (1)\Damaged concrete structures\Damaged concrete structures\test\images'
print("Dataset 1 (Damaged Concrete)...")
files_ds1 = [f for f in os.listdir(ds1_path) if f.endswith('.jpg')]
success_ds1 = sum(1 for f in files_ds1 if add_gps_to_image(os.path.join(ds1_path, f)))
print(f"  Updated: {success_ds1}/{len(files_ds1)}\n")

# Dataset 2
ds2_root = r'd:\dl+nlp\archive (2)\data'
print("Dataset 2 (Road/Cleanliness)...")
total_ds2 = 0
success_ds2 = 0
for root, dirs, files in os.walk(ds2_root):
    for fname in files:
        if fname.endswith('.jpg'):
            total_ds2 += 1
            fpath = os.path.join(root, fname)
            if add_gps_to_image(fpath):
                success_ds2 += 1
            if total_ds2 % 1000 == 0:
                print(f"  Progress: {total_ds2}/9660")

print(f"  Updated: {success_ds2}/{total_ds2}\n")
print("="*60)
print(f"TOTAL: {success_ds1 + success_ds2}/{len(files_ds1) + total_ds2} images")
print("All images now have Delhi area GPS coordinates in EXIF.")
