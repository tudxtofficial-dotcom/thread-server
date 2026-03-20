const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { getBrowser } = require("../scraper/browser");

const router = express.Router();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.get("/threads-image", async (req, res) => {
  const { url } = req.query;
  console.log(`--- 🚀 Bắt đầu Request: ${url} ---`);

  if (!url) return res.status(400).json({ error: "Thiếu URL" });

  let browser;
  let tempDir = "";
  let zipPath = "";

  try {
    console.log("🔍 Đang khởi tạo trình duyệt...");
    browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.setViewportSize({ width: 1200, height: 1200 });

    console.log("🌐 Đang truy cập URL...");
    // Giảm timeout xuống 30s để tránh treo quá lâu
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });

    console.log("💉 Đang inject CSS làm sạch giao diện...");
    await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = `
                header, div[role="navigation"], [id^="login-context-bar"], footer, button { 
                    display: none !important; 
                }
                body { background-color: white !important; }
            `;
      document.head.appendChild(style);
    });

    await delay(3000); // Chờ load ảnh

    const sessionName = `threads-${Date.now()}`;
    tempDir = path.join(__dirname, "../../temp", sessionName);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    let capturedIds = new Set();
    let isPostCaptured = false;

    // GIẢM VÒNG LẶP: Render Free yếu, chỉ nên lấy tầm 5-6 lần cuộn (khoảng 15-20 ảnh)
    const MAX_SCROLLS = 5;
    console.log(`📸 Bắt đầu chụp ảnh (Max ${MAX_SCROLLS} vòng cuộn)...`);

    for (let i = 0; i < MAX_SCROLLS; i++) {
      const commentElements = await page.$$("div[data-virtualized]");
      console.log(
        `Vòng ${i + 1}: Tìm thấy ${commentElements.length} elements.`,
      );

      if (commentElements.length > 0) {
        // Chụp Post gốc
        if (!isPostCaptured) {
          const firstComment = commentElements[0];
          const postHandle = await firstComment.evaluateHandle(
            (el) => el.previousElementSibling,
          );
          const postElement = postHandle.asElement();

          if (postElement) {
            const box = await postElement.boundingBox();
            if (box && box.height > 50) {
              await postElement.screenshot({
                path: path.join(tempDir, "post.png"),
              });
              isPostCaptured = true;
              console.log("✅ Đã chụp Post gốc.");
            }
          }
        }

        // Chụp Comments
        for (const comment of commentElements) {
          const box = await comment.boundingBox();
          if (!box || box.height < 50) continue;

          const scrollY = await page.evaluate(() => window.scrollY);
          const absoluteTop = Math.round(box.y + scrollY);

          if (!capturedIds.has(absoluteTop)) {
            const fileName = `comment_${capturedIds.size}.png`;
            await comment.screenshot({ path: path.join(tempDir, fileName) });
            capturedIds.add(absoluteTop);
          }
        }
      }
      console.log(`📍 Đã chụp tổng cộng: ${capturedIds.size} ảnh.`);
      await page.evaluate(() => window.scrollBy(0, 800));
      await delay(1000);
    }

    console.log("📦 Bắt đầu nén file ZIP...");
    zipPath = path.join(__dirname, "../../temp", `${sessionName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    // Tạo Promise để đợi nén xong mới gửi
    const streamFinished = new Promise((resolve, reject) => {
      output.on("close", resolve);
      archive.on("error", reject);
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();
    await streamFinished;

    console.log("🎁 Nén thành công. Đang gửi file cho Client...");
    res.download(zipPath, `threads_images.zip`, (err) => {
      if (err) console.error("❌ Lỗi khi gửi file:", err);

      // Dọn dẹp sau khi hoàn tất
      if (fs.existsSync(tempDir))
        fs.rmSync(tempDir, { recursive: true, force: true });
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      console.log("🧹 Đã dọn dẹp file tạm.");
    });
  } catch (err) {
    console.error("❌ LỖI HỆ THỐNG:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  } finally {
    if (browser) {
      console.log("🔌 Đang đóng trình duyệt...");
      await browser.close();
    }
  }
});

module.exports = router;
