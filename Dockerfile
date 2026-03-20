# Sử dụng image chính thức từ Microsoft có sẵn Node và Playwright
FROM mcr.microsoft.com/playwright:v1.45.0-jammy

# Thiết lập thư mục làm việc
WORKDIR /app

# Copy package.json và cài đặt dependencies
COPY package*.json ./
RUN npm install

# Copy toàn bộ mã nguồn
COPY . .

# Render yêu cầu dùng cổng được cấp phát qua biến môi trường PORT
ENV PORT=5000
EXPOSE 5000

# Chạy ứng dụng
CMD ["node", "src/app.js"]