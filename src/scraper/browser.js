const { chromium } = require("playwright");

let browser;

async function getBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true, // BẮT BUỘC phải là true khi deploy web
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage", // Quan trọng để tránh lỗi bộ nhớ trên Docker/Cloud
      ],
    });
  }
  return browser;
}

module.exports = { getBrowser };
