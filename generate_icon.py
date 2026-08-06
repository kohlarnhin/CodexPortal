import math
from PIL import Image, ImageDraw

def create_diagonal_gradient(size, stops, x1, y1, x2, y2):
    grad = Image.new("RGBA", (size, size))
    dx = x2 - x1
    dy = y2 - y1
    length_sq = dx*dx + dy*dy
    if length_sq == 0:
        return grad
        
    pixels = []
    for y in range(size):
        fy = y / size
        for x in range(size):
            fx = x / size
            t = ((fx - x1) * dx + (fy - y1) * dy) / length_sq
            t = max(0, min(1, t))
            
            r, g, b = 255, 255, 255
            for i in range(len(stops) - 1):
                if stops[i][0] <= t <= stops[i+1][0]:
                    t_range = stops[i+1][0] - stops[i][0]
                    if t_range > 0:
                        factor = (t - stops[i][0]) / t_range
                    else:
                        factor = 0
                    c1 = stops[i][1]
                    c2 = stops[i+1][1]
                    r = int(c1[0] + factor * (c2[0] - c1[0]))
                    g = int(c1[1] + factor * (c2[1] - c1[1]))
                    b = int(c1[2] + factor * (c2[2] - c1[2]))
                    break
            pixels.append((r, g, b, 255))
    grad.putdata(pixels)
    return grad

def draw_icon():
    size = 1024
    scale = 4
    hr_size = size * scale
    m = 10.24 * scale
    
    # Create raw icon at 100x100 relative space
    raw_img = Image.new("RGBA", (hr_size, hr_size), (0, 0, 0, 0))

    hr_bg_mask = Image.new("L", (hr_size, hr_size), 0)
    draw_bg = ImageDraw.Draw(hr_bg_mask)
    draw_bg.rounded_rectangle([0, 0, hr_size-1, hr_size-1], radius=22*m, fill=255)
    
    bg_img = Image.new("RGBA", (hr_size, hr_size), (0, 0, 0, 255))
    raw_img.paste(bg_img, (0,0), hr_bg_mask)

    def get_bbox(center, r, width):
        outer_r = r + width/2
        return [center - outer_r, center - outer_r, center + outer_r, center + outer_r]

    def add_cap(draw_obj, angle_deg, center, r, width, color):
        angle_rad = math.radians(angle_deg)
        cx = center + r * math.cos(angle_rad)
        cy = center + r * math.sin(angle_rad)
        cap_r = width / 2
        draw_obj.ellipse([(cx - cap_r, cy - cap_r), (cx + cap_r, cy + cap_r)], fill=color)

    center = 50 * m

    # 2. Outer Ring
    ring_r = 38 * m
    ring_w = 3 * m
    draw_base_ring = ImageDraw.Draw(raw_img)
    ring_bbox = get_bbox(center, ring_r, ring_w)
    
    draw_base_ring.arc(ring_bbox, start=45, end=315, fill=(30, 30, 36, 255), width=int(ring_w))
    add_cap(draw_base_ring, 45, center, ring_r, ring_w, (30, 30, 36, 255))
    add_cap(draw_base_ring, 315, center, ring_r, ring_w, (30, 30, 36, 255))

    # 3. Outer Ring Accent
    ring_grad = create_diagonal_gradient(512, [
        (0.0, (56, 189, 248)),
        (1.0, (129, 140, 248))
    ], 0.7, 0.1, 0.9, 0.6).resize((hr_size, hr_size), Image.Resampling.LANCZOS)
    
    ring_mask = Image.new("L", (hr_size, hr_size), 0)
    draw_ring_mask = ImageDraw.Draw(ring_mask)
    draw_ring_mask.arc(ring_bbox, start=315, end=360, fill=255, width=int(ring_w))
    add_cap(draw_ring_mask, 315, center, ring_r, ring_w, 255)
    add_cap(draw_ring_mask, 360, center, ring_r, ring_w, 255)
    
    raw_img.paste(ring_grad, (0,0), ring_mask)

    # 4. Inner C
    c_r = 24 * m
    c_w = 11 * m
    c_bbox = get_bbox(center, c_r, c_w)

    c_grad = create_diagonal_gradient(512, [
        (0.0, (255, 255, 255)),
        (0.6, (226, 232, 240)),
        (1.0, (148, 163, 184))
    ], 0.2, 0.2, 0.8, 0.8).resize((hr_size, hr_size), Image.Resampling.LANCZOS)
    
    c_mask = Image.new("L", (hr_size, hr_size), 0)
    draw_c_mask = ImageDraw.Draw(c_mask)
    draw_c_mask.arc(c_bbox, start=45, end=315, fill=255, width=int(c_w))
    add_cap(draw_c_mask, 45, center, c_r, c_w, 255)
    add_cap(draw_c_mask, 315, center, c_r, c_w, 255)
    
    raw_img.paste(c_grad, (0,0), c_mask)

    # 5. Floating accent dot
    draw_dot = ImageDraw.Draw(raw_img)
    dot_r = 5.5 * m
    dot_cx = 67 * m
    dot_cy = 67 * m
    draw_dot.ellipse([(dot_cx - dot_r, dot_cy - dot_r), (dot_cx + dot_r, dot_cy + dot_r)], fill=(56, 189, 248, 255))

    # Apply macOS standard icon 82% scaling & padding
    target_hr_size = int(hr_size * 0.82)
    scaled_raw = raw_img.resize((target_hr_size, target_hr_size), Image.Resampling.LANCZOS)
    
    final_canvas = Image.new("RGBA", (hr_size, hr_size), (0, 0, 0, 0))
    offset = (hr_size - target_hr_size) // 2
    final_canvas.paste(scaled_raw, (offset, offset))

    out = final_canvas.resize((size, size), Image.Resampling.LANCZOS)
    out.save("app-icon.png")

if __name__ == "__main__":
    draw_icon()
