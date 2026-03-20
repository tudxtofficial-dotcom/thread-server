const express = require("express");
const fs = require("fs");
const path = require("path");
const archiver = require("archiver");
const { getBrowser } = require("../scraper/browser");

const router = express.Router();
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

router.get("/threads-image", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "Thiếu URL" });

  const browser = await getBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const width = 1200;
    await page.setViewportSize({ width, height: 1200 });

    console.log("🔥 Đang tải trang...");
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });

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

    await delay(4000);

    const sessionName = `threads-${Date.now()}`;
    const tempDir = path.join(__dirname, "../../temp", sessionName);
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    let capturedIds = new Set();
    let isPostCaptured = false;

    for (let i = 0; i < 8; i++) {
      // Giảm số vòng lặp để test nhanh hơn
      const commentElements = await page.$$("div[data-virtualized]");

      if (commentElements.length > 0) {
        if (!isPostCaptured) {
          const firstComment = commentElements[0];
          const postElementHandle = await firstComment.evaluateHandle(
            (el) => el.previousElementSibling,
          );
          const postElement = postElementHandle.asElement();

          if (postElement) {
            const postBox = await postElement.boundingBox();
            if (postBox && postBox.height > 50) {
              await postElement.screenshot({
                path: path.join(tempDir, "post.png"),
              });
              isPostCaptured = true;
              const scrollY = await page.evaluate(() => window.scrollY);
              capturedIds.add(Math.round(postBox.y + scrollY));
            }
          }
        }

        for (const comment of commentElements) {
          const box = await comment.boundingBox();
          if (!box || box.height < 50) continue;
          const scrollY = await page.evaluate(() => window.scrollY);
          const absoluteTop = Math.round(box.y + scrollY);

          if (capturedIds.has(absoluteTop)) continue;

          const fileName = `comment_${capturedIds.size}.png`;
          await comment.screenshot({ path: path.join(tempDir, fileName) });
          capturedIds.add(absoluteTop);
        }
      }
      await page.evaluate(() => window.scrollBy(0, 900));
      await delay(500);
    }

    // --- XỬ LÝ NÉN ZIP ---
    const zipPath = path.join(__dirname, "../../temp", `${sessionName}.zip`);
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => {
      // Gửi file ZIP về client
      res.download(zipPath, `threads_images.zip`, (err) => {
        // Dọn dẹp sau khi gửi xong
        if (fs.existsSync(tempDir))
          fs.rmSync(tempDir, { recursive: true, force: true });
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      });
    });

    archive.pipe(output);
    archive.directory(tempDir, false);
    await archive.finalize();
  } catch (err) {
    console.error("❌ LỖI:", err.message);
    res.status(500).send("Lỗi xử lý server");
  } finally {
    await page.close();
    await context.close();
  }
});

module.exports = router;
