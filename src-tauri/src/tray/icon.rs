use tauri::image::Image;

pub(super) enum ActionIcon {
    Window,
    Settings,
}

fn line_distance(x: f64, y: f64, from: (f64, f64), to: (f64, f64)) -> f64 {
    let dx = to.0 - from.0;
    let dy = to.1 - from.1;
    let t = (((x - from.0) * dx + (y - from.1) * dy) / (dx * dx + dy * dy)).clamp(0.0, 1.0);
    (x - from.0 - t * dx).hypot(y - from.1 - t * dy)
}

// 透明底、统一 18 pt / 1.3 pt 线宽；高分辨率绘制避免旧系统图标的白底和锯齿。
pub(super) fn action_icon(kind: ActionIcon, dark: bool) -> Image<'static> {
    let scale = if cfg!(target_os = "macos") { 3 } else { 1 };
    let size = 18 * scale;
    let mut pixels = vec![0; size * size * 4];
    let color = if dark { [226, 227, 229] } else { [66, 68, 72] };
    let gear: Vec<(f64, f64)> = (0..8).flat_map(|tooth| {
        [(-0.30, 5.3), (-0.18, 6.8), (0.18, 6.8), (0.30, 5.3)]
            .map(move |(offset, radius)| {
                let angle = (tooth as f64 + offset) * std::f64::consts::TAU / 8.0 - std::f64::consts::FRAC_PI_2;
                (9.0 + radius * angle.cos(), 9.0 + radius * angle.sin())
            })
    }).collect();

    for row in 0..size {
        for column in 0..size {
            let x = (column as f64 + 0.5) / scale as f64;
            let y = (row as f64 + 0.5) / scale as f64;
            let distance = match kind {
                ActionIcon::Window => {
                    // 圆角窗口外框、顶部栏与侧栏。
                    let qx = (x - 9.0).abs() - 5.1;
                    let qy = (y - 9.0).abs() - 3.9;
                    let frame = (qx.max(0.0).hypot(qy.max(0.0)) + qx.max(qy).min(0.0) - 1.5).abs();
                    frame.min(line_distance(x, y, (2.8, 7.0), (15.2, 7.0)))
                        .min(line_distance(x, y, (7.0, 7.0), (7.0, 14.0)))
                }
                ActionIcon::Settings => {
                    let mut distance = ((x - 9.0).hypot(y - 9.0) - 2.2).abs();
                    for index in 0..gear.len() {
                        distance = distance.min(line_distance(x, y, gear[index], gear[(index + 1) % gear.len()]));
                    }
                    distance
                }
            };
            let alpha = ((0.65 - distance) * scale as f64 + 0.5).clamp(0.0, 1.0);
            pixels[(row * size + column) * 4..][..4]
                .copy_from_slice(&[color[0], color[1], color[2], (alpha * 255.0).round() as u8]);
        }
    }
    Image::new_owned(pixels, size as u32, size as u32)
}

pub(super) fn status_icon(remaining: Option<u8>) -> Image<'static> {
    let color = match remaining {
        Some(0..=10) => [239, 82, 80],
        Some(11..=30) => [238, 170, 51],
        Some(_) => [76, 190, 95],
        None => [150, 154, 160],
    };
    let size = 32usize;
    let mut pixels = vec![0; size * size * 4];
    for y in 0..size {
        for x in 0..size {
            let distance = ((x as f64 - 15.5).powi(2) + (y as f64 - 15.5).powi(2)).sqrt();
            let alpha = ((11.5 - distance).clamp(0.0, 1.0) * 255.0).round() as u8;
            pixels[(y * size + x) * 4..][..4].copy_from_slice(&[color[0], color[1], color[2], alpha]);
        }
    }
    Image::new_owned(pixels, size as u32, size as u32)
}
