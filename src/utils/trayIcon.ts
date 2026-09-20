export interface TrayIconState {
  remaining: number | null;
  revision: number;
  wide: boolean;
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

/** 独立的浅色读数底，避免系统深色模式与实际菜单栏背景不一致时丢失对比度。 */
export function renderTrayIcon(state: TrayIconState) {
  const width = state.wide ? 40 : 20;
  const height = state.wide ? 18 : 20;
  const density = 3;
  const canvas = document.createElement('canvas');
  canvas.width = width * density;
  canvas.height = height * density;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法绘制托盘图标');
  context.scale(density, density);

  const remaining = state.remaining === null || !Number.isFinite(state.remaining)
    ? null : Math.round(Math.max(0, Math.min(100, state.remaining)));
  const foreground = '#202124';
  const secondary = '#44474B';
  const color = remaining === null ? secondary
    : remaining <= 10 ? '#B93632'
    : remaining <= 30 ? '#9C6B18'
    : '#358657';
  const x = 0.75;
  const y = state.wide ? 1.5 : 1.25;
  const barWidth = width - (state.wide ? 5 : 1.5);
  const barHeight = height - y * 2;
  const centerX = x + barWidth / 2;

  roundedRect(context, x, y, barWidth, barHeight, 3.25);
  context.fillStyle = '#F3F4F5';
  context.fill();
  context.strokeStyle = '#8A8E93';
  context.lineWidth = 0.9;
  context.stroke();
  if (state.wide) {
    roundedRect(context, x + barWidth + 1.6, height / 2 - 2.2, 1.8, 4.4, 0.9);
    context.fillStyle = remaining !== null && remaining <= 10 ? color : '#9A9EA4';
    context.fill();
  }

  const trackX = x + 2.7;
  const trackY = state.wide ? 13 : 16.2;
  const trackWidth = barWidth - 5.4;
  const trackHeight = state.wide ? 1.7 : 1.2;
  roundedRect(context, trackX, trackY, trackWidth, trackHeight, trackHeight / 2);
  context.fillStyle = '#D8DCDF';
  context.fill();
  if (remaining !== null && remaining > 0) {
    const filledWidth = trackWidth * remaining / 100;
    roundedRect(context, trackX, trackY, filledWidth, trackHeight, Math.min(filledWidth, trackHeight) / 2);
    context.fillStyle = color;
    context.fill();
  }

  context.fillStyle = remaining !== null && remaining <= 10 ? color : foreground;
  context.textAlign = 'left';
  context.textBaseline = 'alphabetic';
  if (state.wide) {
    const numberFont = '700 10.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const percentFont = '600 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const label = remaining === null ? '—' : String(remaining);
    context.font = numberFont;
    const numberWidth = context.measureText(label).width;
    context.font = percentFont;
    const suffixWidth = remaining === null ? 0 : context.measureText('%').width + 0.7;
    const labelX = centerX - (numberWidth + suffixWidth) / 2;
    context.font = numberFont;
    context.fillText(label, labelX, 11.1);
    if (remaining !== null) {
      context.font = percentFont;
      context.fillStyle = remaining <= 10 ? color : secondary;
      context.fillText('%', labelX + numberWidth + 0.7, 11.1);
    }
  } else {
    // 方形托盘槽位中分行放置数字与百分号，避免 100% 横向被挤小。
    context.textAlign = 'center';
    context.font = '700 9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    context.fillText(remaining === null ? '—' : String(remaining), centerX, remaining === null ? 11 : 10);
    if (remaining !== null) {
      context.font = '600 6px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      context.fillStyle = remaining <= 10 ? color : secondary;
      context.fillText('%', centerX, 14.5);
    }
  }

  return {
    revision: state.revision,
    width: canvas.width,
    height: canvas.height,
    rgba: Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data),
  };
}
