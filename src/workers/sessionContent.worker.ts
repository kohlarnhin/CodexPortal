import { parseSessionContent } from '../utils/sessionContent';

// 全量日志解析放在 Worker 中，避免大文件占用页面主线程。
self.onmessage = (event: MessageEvent<string>) => {
  self.postMessage(parseSessionContent(event.data));
};
