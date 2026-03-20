const { chromium } = require("playwright");

async function getBrowser() {
  return await chromium.launch({
    headless: true, // Bắt buộc phải là true
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });
}

module.exports = { getBrowser };
