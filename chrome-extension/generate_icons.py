#!/usr/bin/env python3
"""Generate placeholder icons for Chrome Extension.

Run this to create simple icon files if you don't have custom ones.
Requires PIL/Pillow: pip install Pillow
"""

from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Error: Pillow not installed. Run: pip install Pillow")
    exit(1)

ICON_DIR = Path(__file__).parent / "icons"
ICON_DIR.mkdir(exist_ok=True)

SIZES = [16, 48, 128]
BG_COLOR = (11, 16, 32)  # Hush dark blue
ORANGE = (255, 153, 0)  # Hush orange

def create_icon(size):
    """Create a simple Hush icon."""
    img = Image.new('RGB', (size, size), color=BG_COLOR)
    draw = ImageDraw.Draw(img)
    
    # Draw "🤫" emoji or "H" letter
    # Simple approach: draw an orange circle with "H"
    margin = size // 8
    draw.ellipse(
        [margin, margin, size - margin, size - margin],
        fill=ORANGE,
        outline=None
    )
    
    # Try to add "H" text
    try:
        font_size = size // 2
        # Use default font
        font = ImageFont.load_default()
        text = "H"
        
        # Center text
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]
        x = (size - text_width) // 2
        y = (size - text_height) // 2 - size // 12
        
        draw.text((x, y), text, fill=BG_COLOR, font=font)
    except Exception as e:
        print(f"Warning: Could not add text to icon: {e}")
    
    return img

def main():
    print("Generating Chrome Extension icons...")
    
    for size in SIZES:
        icon_path = ICON_DIR / f"icon{size}.png"
        icon = create_icon(size)
        icon.save(icon_path, 'PNG')
        print(f"✓ Created {icon_path}")
    
    print("\nIcons generated successfully!")
    print("Note: These are placeholder icons. Replace with custom designs if desired.")

if __name__ == '__main__':
    main()
