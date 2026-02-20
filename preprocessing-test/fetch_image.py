import urllib.request, base64, sys, json

# The image from the conversation needs to be provided as base64
# We'll handle this differently - just check if input exists
import os
path = sys.argv[1] if len(sys.argv) > 1 else 'input.jpg'
if os.path.exists(path):
    print(f"Input image found: {path}")
    import cv2
    img = cv2.imread(path)
    print(f"Dimensions: {img.shape}")
else:
    print(f"Image not found at {path}")
