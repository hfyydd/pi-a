import os
import math
import subprocess
from PIL import Image, ImageDraw, ImageFilter

def create_pi_icon(size=1024):
    # 4x supersampling for ultra smooth anti-aliased curves
    scale = 4
    w = size * scale
    h = size * scale
    
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    
    # 1. Background Squircle (macOS app icon standard: rx = 22.5%)
    corner_radius = int(w * 0.225)
    margin = int(w * 0.04)
    rect_box = [margin, margin, w - margin, h - margin]
    
    # Create background mask with rounded rectangle
    bg_mask = Image.new("L", (w, h), 0)
    bg_draw = ImageDraw.Draw(bg_mask)
    bg_draw.rounded_rectangle(rect_box, radius=corner_radius, fill=255)
    
    # Create background image with gradient
    bg_img = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    bg_draw_img = Image.Draw if hasattr(Image, "Draw") else ImageDraw.Draw
    
    # Render background using PIL ImageDraw with vertical gradient + center glow
    bg_pixels = bg_img.load()
    cx, cy = w * 0.5, h * 0.4
    max_r = w * 0.7
    
    for y in range(0, h, 2):
        ty = y / h
        for x in range(0, w, 2):
            tx = x / w
            t_diag = (tx + ty) / 2.0
            
            # Distance from ambient glow center
            dist = math.sqrt((x - cx)**2 + (y - cy)**2) / max_r
            glow = max(0.0, 1.0 - dist) ** 2
            
            r_val = int(min(255, 18 * (1 - t_diag) + 8 * t_diag + 85 * glow))
            g_val = int(min(255, 15 * (1 - t_diag) + 6 * t_diag + 32 * glow))
            b_val = int(min(255, 38 * (1 - t_diag) + 16 * t_diag + 145 * glow))
            
            col = (r_val, g_val, b_val, 255)
            bg_pixels[x, y] = col
            if x + 1 < w: bg_pixels[x + 1, y] = col
            if y + 1 < h:
                bg_pixels[x, y + 1] = col
                if x + 1 < w: bg_pixels[x + 1, y + 1] = col

    # Apply squircle mask to background
    bg_img.putalpha(bg_mask)
    
    # 2. Draw border stroke (subtle rim glow)
    rim_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    rim_draw = ImageDraw.Draw(rim_img)
    rim_draw.rounded_rectangle(rect_box, radius=corner_radius, outline=(168, 85, 247, 180), width=int(w * 0.008))
    
    # 3. Render Pi (π) Symbol using vector polygon/path drawing
    s = w / 1000.0
    
    pi_mask = Image.new("L", (w, h), 0)
    pi_draw = ImageDraw.Draw(pi_mask)
    
    # High-precision cubic bezier curve generator
    def bezier_curve(p0, p1, p2, p3, steps=40):
        pts = []
        for i in range(steps + 1):
            t = i / steps
            x = (1-t)**3 * p0[0] + 3*(1-t)**2 * t * p1[0] + 3*(1-t) * t**2 * p2[0] + t**3 * p3[0]
            y = (1-t)**3 * p0[1] + 3*(1-t)**2 * t * p1[1] + 3*(1-t) * t**2 * p2[1] + t**3 * p3[1]
            pts.append((x * s, y * s))
        return pts

    # Construct complete Pi outline polygon
    poly = []
    
    # Top bar left cap curve
    poly.extend(bezier_curve((220, 310), (220, 270), (250, 250), (290, 250)))
    # Top bar top edge to right cap
    poly.extend(bezier_curve((290, 250), (450, 250), (650, 250), (710, 250)))
    poly.extend(bezier_curve((710, 250), (750, 250), (780, 270), (780, 310)))
    poly.extend(bezier_curve((780, 310), (780, 340), (750, 360), (720, 360)))
    
    # Top bar right to right leg top
    poly.append((650 * s, 360 * s))
    
    # Right leg outer edge going down
    poly.extend(bezier_curve((650, 360), (650, 500), (650, 600), (650, 680)))
    # Right leg hook bottom curve
    poly.extend(bezier_curve((650, 680), (650, 730), (680, 750), (720, 750)))
    poly.extend(bezier_curve((720, 750), (745, 750), (770, 735), (790, 710)))
    poly.extend(bezier_curve((790, 710), (810, 690), (835, 690), (850, 710)))
    poly.extend(bezier_curve((850, 710), (865, 730), (860, 760), (835, 790)))
    poly.extend(bezier_curve((835, 790), (795, 835), (745, 850), (690, 850)))
    poly.extend(bezier_curve((690, 850), (610, 850), (560, 790), (560, 690)))
    
    # Right leg inner edge going up
    poly.extend(bezier_curve((560, 690), (560, 600), (560, 480), (560, 360)))
    
    # Gap between legs (under top bar)
    poly.append((450 * s, 360 * s))
    
    # Left leg inner edge going down
    poly.extend(bezier_curve((450, 360), (450, 500), (450, 650), (450, 710)))
    # Left leg bottom curve (wavy flare to left)
    poly.extend(bezier_curve((450, 710), (450, 760), (425, 800), (380, 825)))
    poly.extend(bezier_curve((380, 825), (350, 840), (320, 830), (295, 810)))
    poly.extend(bezier_curve((295, 810), (275, 790), (270, 760), (285, 735)))
    poly.extend(bezier_curve((285, 735), (300, 710), (330, 710), (350, 730)))
    poly.extend(bezier_curve((350, 730), (360, 740), (365, 740), (370, 730)))
    poly.extend(bezier_curve((370, 730), (375, 710), (375, 680), (375, 650)))
    
    # Left leg outer edge going up
    poly.extend(bezier_curve((375, 650), (375, 520), (375, 420), (375, 360)))
    
    # Top bar left inner to cap
    poly.append((290 * s, 360 * s))
    poly.extend(bezier_curve((290, 360), (250, 360), (220, 340), (220, 310)))

    pi_draw.polygon(poly, fill=255)

    # Pi Gradient fill: Electric Cyan -> Violet -> Magenta
    pi_grad_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pi_pixels = pi_grad_img.load()
    
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            tx = x / w
            ty = y / h
            t_pi = min(1.0, max(0.0, tx * 0.6 + ty * 0.8))
            
            if t_pi < 0.4:
                ratio = t_pi / 0.4
                r_val = int(56 + (168 - 56) * ratio)
                g_val = int(189 + (85 - 189) * ratio)
                b_val = int(248 + (247 - 248) * ratio)
            elif t_pi < 0.8:
                ratio = (t_pi - 0.4) / 0.4
                r_val = int(168 + (236 - 168) * ratio)
                g_val = int(85 + (72 - 85) * ratio)
                b_val = int(247 + (153 - 247) * ratio)
            else:
                ratio = (t_pi - 0.8) / 0.2
                r_val = int(236 + (244 - 236) * ratio)
                g_val = int(72 + (63 - 72) * ratio)
                b_val = int(153 + (94 - 153) * ratio)
                
            col = (r_val, g_val, b_val, 255)
            pi_pixels[x, y] = col
            if x + 1 < w: pi_pixels[x + 1, y] = col
            if y + 1 < h:
                pi_pixels[x, y + 1] = col
                if x + 1 < w: pi_pixels[x + 1, y + 1] = col
    
    # Create Pi Drop Shadow / Glow
    pi_glow_mask = pi_mask.filter(ImageFilter.GaussianBlur(radius=int(w * 0.025)))
    pi_glow_img = Image.new("RGBA", (w, h), (168, 85, 247, 160))
    pi_glow_img.putalpha(pi_glow_mask)

    # Combine Glow + Pi Symbol
    pi_final = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pi_final.paste(pi_glow_img, (0, 0), pi_glow_img)
    
    pi_symbol_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    pi_symbol_img.paste(pi_grad_img, (0, 0), pi_mask)
    pi_final.paste(pi_symbol_img, (0, 0), pi_symbol_img)

    # 4. Combine base background + rim + pi symbol
    final_img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    final_img.paste(bg_img, (0, 0), bg_img)
    final_img.paste(rim_img, (0, 0), rim_img)
    final_img.paste(pi_final, (0, 0), pi_final)
    
    # Downsample using Lanczos to target size
    out = final_img.resize((size, size), Image.Resampling.LANCZOS)
    return out

if __name__ == "__main__":
    os.makedirs("resources", exist_ok=True)
    os.makedirs("frontend/public", exist_ok=True)

    print("Generating high-resolution 1024x1024 Pi-a icon...")
    icon_1024 = create_pi_icon(1024)
    
    # Save main PNG files
    icon_1024.save("resources/app-icon.png")
    icon_1024.save("frontend/public/icon.png")
    
    # 512x512
    icon_512 = icon_1024.resize((512, 512), Image.Resampling.LANCZOS)
    icon_512.save("frontend/public/icon-512.png")
    
    # 128x128
    icon_128 = icon_1024.resize((128, 128), Image.Resampling.LANCZOS)
    icon_128.save("frontend/public/icon-128.png")

    # Generate macOS iconset for icns
    iconset_dir = "resources/app-icon.iconset"
    os.makedirs(iconset_dir, exist_ok=True)
    
    sizes = [16, 32, 64, 128, 256, 512]
    for s in sizes:
        img_s = icon_1024.resize((s, s), Image.Resampling.LANCZOS)
        img_s.save(f"{iconset_dir}/icon_{s}x{s}.png")
        img_2x = icon_1024.resize((s * 2, s * 2), Image.Resampling.LANCZOS)
        img_2x.save(f"{iconset_dir}/icon_{s}x{s}@2x.png")

    print("Converting iconset to ICNS...")
    subprocess.run(["iconutil", "-c", "icns", iconset_dir, "-o", "resources/app-icon.icns"], check=True)
    print("Successfully generated resources/app-icon.icns and resources/app-icon.png")
