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
    let context;
    let tempDir = "";
    let zipPath = "";

    try {
        console.log("🔍 Đang khởi tạo trình duyệt...");
        browser = await getBrowser();
        context = await browser.newContext();
        const page = await context.newPage();

        await page.setViewportSize({ width: 1200, height: 1200 });

        console.log("🌐 Đang truy cập URL...");
        // Tăng timeout lên một chút nhưng tối ưu cách đợi
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

        // 1. MỞ KHÓA NỘI DUNG ẨN (Spoiler/Nội dung dài)
        console.log("🔓 Đang quét và kích hoạt các nội dung bị che...");
        await page.evaluate(async () => {
            const hiddenButtons = Array.from(document.querySelectorAll('div[role="button"][tabindex="0"]'));
            for (const btn of hiddenButtons) {
                // Chỉ click nếu nút có chữ và không chứa icon (tránh nút Like/Share/Rep)
                const hasText = btn.innerText && btn.innerText.trim().length > 0;
                const isActionBtn = btn.querySelector('svg'); 
                
                if (hasText && !isActionBtn) {
                    btn.click();
                }
            }
        });

        // Chờ layout ổn định sau khi click bung nội dung
        await delay(2000); 

        console.log("💉 Đang inject CSS làm sạch giao diện...");
        await page.evaluate(() => {
            const style = document.createElement("style");
            style.textContent = `
                header, div[role="navigation"], [id^="login-context-bar"], footer, button, svg { 
                    display: none !important; 
                }
                body { background-color: white !important; }
                div[data-virtualized] { border-bottom: 1px solid #f0f0f0 !important; }
            `;
            document.head.appendChild(style);
        });

        const sessionName = `threads-${Date.now()}`;
        // Sử dụng thư mục /tmp trên Linux (Render) để đảm bảo quyền ghi
        tempDir = path.join(process.cwd(), "temp", sessionName);
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

        let capturedIds = new Set();
        let isPostCaptured = false;

        // GIẢM VÒNG LẶP ĐỂ TRÁNH 502: Render Free chỉ chịu được khoảng 4-5 vòng
        const MAX_SCROLLS = 4;
        console.log(`📸 Bắt đầu chụp ảnh (Vòng cuộn tối đa: ${MAX_SCROLLS})...`);

        for (let i = 0; i < MAX_SCROLLS; i++) {
            const commentElements = await page.$$("div[data-virtualized]");
            console.log(`Vòng ${i + 1}: Tìm thấy ${commentElements.length} phần tử.`);

            if (commentElements.length > 0) {
                // Chụp Post gốc (Chỉ chụp 1 lần duy nhất)
                if (!isPostCaptured) {
                    const firstComment = commentElements[0];
                    const postHandle = await firstComment.evaluateHandle((el) => el.previousElementSibling);
                    const postElement = postHandle.asElement();

                    if (postElement) {
                        const box = await postElement.boundingBox();
                        if (box && box.height > 30) {
                            await postElement.screenshot({ path: path.join(tempDir, "0_post.png") });
                            isPostCaptured = true;
                            console.log("✅ Đã chụp Post gốc.");
                        }
                    }
                }

                // Chụp các Comment hiện có trên màn hình
                for (const comment of commentElements) {
                    const box = await comment.boundingBox();
                    if (!box || box.height < 30) continue;

                    const scrollY = await page.evaluate(() => window.scrollY);
                    const absoluteTop = Math.round(box.y + scrollY);

                    // Kiểm tra trùng lặp dựa trên vị trí tuyệt đối
                    if (!capturedIds.has(absoluteTop)) {
                        const fileName = `comment_${capturedIds.size + 1}.png`;
                        await comment.screenshot({ path: path.join(tempDir, fileName) });
                        capturedIds.add(absoluteTop);
                    }
                }
            }
            
            console.log(`📍 Tiến độ: ${capturedIds.size} ảnh đã lưu.`);
            // Cuộn xuống để load thêm dữ liệu
            await page.evaluate(() => window.scrollBy(0, 700));
            await delay(1200); 
        }

        if (capturedIds.size === 0 && !isPostCaptured) {
            throw new Error("Không tìm thấy nội dung để chụp. Link có thể sai hoặc lỗi layout.");
        }

        console.log("📦 Đang nén file ZIP...");
        zipPath = path.join(process.cwd(), "temp", `${sessionName}.zip`);
        const output = fs.createWriteStream(zipPath);
        const archive = archiver("zip", { zlib: { level: 9 } });

        const streamFinished = new Promise((resolve, reject) => {
            output.on("close", resolve);
            archive.on("error", reject);
        });

        archive.pipe(output);
        archive.directory(tempDir, false);
        await archive.finalize();
        await streamFinished;

        console.log("🎁 Nén thành công. Đang gửi file...");
        res.download(zipPath, `threads_images.zip`, (err) => {
            if (err) console.error("❌ Lỗi khi gửi file cho client:", err);

            // DỌN DẸP HỆ THỐNG
            try {
                if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
                if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
                console.log("🧹 Đã dọn dẹp sạch sẽ thư mục tạm.");
            } catch (cleanErr) {
                console.error("⚠️ Lỗi khi dọn dẹp:", cleanErr.message);
            }
        });

    } catch (err) {
        console.error("❌ LỖI HỆ THỐNG:", err.stack);
        if (!res.headersSent) {
            res.status(500).json({ error: "Server bị quá tải hoặc lỗi xử lý", details: err.message });
        }
    } finally {
        if (context) await context.close();
        if (browser) {
            console.log("🔌 Đã đóng trình duyệt.");
            await browser.close();
        }
    }
});

module.exports = router;