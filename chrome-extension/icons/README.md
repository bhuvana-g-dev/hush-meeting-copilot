# Chrome Extension Icons

This directory contains the extension icons in three sizes required by Chrome:
- `icon16.png` - 16x16 pixels (toolbar)
- `icon48.png` - 48x48 pixels (extension management)
- `icon128.png` - 128x128 pixels (Chrome Web Store)

## Generating Icons

You can create these icons using any image editor or online tool. The icons should represent the Hush brand and be recognizable at small sizes.

### Quick Icon Generation Options:

1. **Using an online tool:**
   - Go to https://www.favicon-generator.org/
   - Upload a square logo or design
   - Download the generated icons

2. **Using ImageMagick (if installed):**
   ```bash
   # Create simple placeholder icons with orange background
   convert -size 16x16 xc:#FF9900 -pointsize 10 -fill white -gravity center -annotate +0+0 "H" icon16.png
   convert -size 48x48 xc:#FF9900 -pointsize 32 -fill white -gravity center -annotate +0+0 "H" icon48.png
   convert -size 128x128 xc:#FF9900 -pointsize 80 -fill white -gravity center -annotate +0+0 "H" icon128.png
   ```

3. **Using Python PIL:**
   ```python
   from PIL import Image, ImageDraw, ImageFont
   
   for size in [16, 48, 128]:
       img = Image.new('RGB', (size, size), '#FF9900')
       draw = ImageDraw.Draw(img)
       font_size = int(size * 0.6)
       # Draw 'H' in center (simplified - you may need to adjust)
       draw.text((size//2, size//2), 'H', fill='white', anchor='mm')
       img.save(f'icon{size}.png')
   ```

## Temporary Placeholder

For development and testing, you can use simple colored squares. The extension will still work without custom icons, though Chrome will show a default icon.

To create minimal placeholder PNG files, run this in your terminal:

```bash
cd chrome-extension/icons
# Create 1x1 pixel orange placeholders (Chrome will scale)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x02\x00\x00\x00\x90wS\xde\x00\x00\x00\x0cIDATx\x9cc\xf8\x9f\x81\x00\x00\x03\x01\x01\x00\x18\xdd\x8d\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > icon16.png
cp icon16.png icon48.png
cp icon16.png icon128.png
```
