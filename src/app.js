const express = require("express");
const cors = require("cors"); // 1. Import thư viện
const dotenv = require("dotenv");
dotenv.config();
const threadsRouter = require("./routes/threads.route"); // Giả sử file router của bạn ở đây

const app = express();

// 2. Kích hoạt CORS (Phải đặt TRƯỚC các app.use(router))
app.use(
  cors({
    origin: process.env.CLIENT_URL, // Chỉ cho phép Next.js port 3000 truy cập
    methods: ["GET", "POST"],
    exposedHeaders: ["Content-Disposition"], // Quan trọng để Client đọc được tên file zip
  }),
);

app.use("/api", threadsRouter);

app.listen(5000, () => console.log("🚀 Server đang chạy tại port 5000"));
