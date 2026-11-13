/** 浏览器测试与截图共用入口。CI 使用 Playwright 浏览器，本机可指定已有 Chromium。 */
const { chromium } = require('playwright');

function launchChromium(options) {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  return chromium.launch(Object.assign({}, options, executablePath ? { executablePath } : {}));
}

module.exports = { launchChromium };
