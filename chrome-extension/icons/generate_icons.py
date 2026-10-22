#!/usr/bin/env python3
"""
Generate simple placeholder icons for the Hush Chrome Extension.
Creates orange square icons with white 'H' letter in three sizes: 16x16, 48x48, 128x128.

Usage:
    python generate_icons.py

Requirements:
    pip install pillow
"""

from PIL import Image, ImageDraw, ImageFont
import os

# Icon sizes required by Chrome
SIZES = [16, 48, 128]

# Hush brand colors
BACKGROUND_COLOR = '#FF9900'  # Orange
TEXT_COLOR = '#FFFFFF'  # White

def generate_icon(size):
    """Generate a simple icon with 'H' letter."""
    # Create new image with orange background
    img = Image.new('RGB', (size, size), BACKGROUND_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Calculate font size (60% of image size)
    font_size = int(size * 0.6)
    
    # Try to use a nice font, fall back to default if not available
    try:
        # Try common system fonts
        for font_name in ['Arial', 'Helvetica', 'DejaVuSans']:
            try:
                font = ImageFont.truetype(font_name, font_size)
                break
            except:
                continue
        else:
            # Fall back to PIL default font
            font = ImageFont.load_default()
    except:
        font = ImageFont.load_default()
    
    # Draw 'H' in center
    text = "H"
    
    # Get text bounding box for centering
    bbox = draw.textbbox((0, 0), text, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    
    # Calculate position to center text
    x = (size - text_width) // 2 - bbox[0]
    y = (size - text_height) // 2 - bbox[1]
    
    # Draw text
    draw.text((x, y), text, fill=TEXT_COLOR, font=font)
    
    return img

def main():
    """Generate all icon sizes."""
    # Get directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    
    print("Generating Hush Chrome Extension icons...")
    print(f"Output directory: {script_dir}")
    
    for size in SIZES:
        filename = f"icon{size}.png"
        filepath = os.path.join(script_dir, filename)
        
        print(f"  Generating {filename}...", end=' ')
        
        try:
            img = generate_icon(size)
            img.save(filepath, 'PNG')
            print("✓")
        except Exception as e:
            print(f"✗ Error: {e}")
            return 1
    
    print("\n✓ All icons generated successfully!")
    print("\nNext steps:")
    print("1. Load the chrome-extension/ directory in Chrome")
    print("2. Go to chrome://extensions/")
    print("3. Enable 'Developer mode'")
    print("4. Click 'Load unpacked' and select chrome-extension/")
    
    return 0

if __name__ == "__main__":
    exit(main())
