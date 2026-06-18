# AgentTeam Studio - Hệ Thống AI Agent Tự Động Hóa Quy Trình Video

Chào mừng bạn đến với **AgentTeam Studio**, một giải pháp dashboard điều phối và tự động hóa nhóm AI Agent chạy ngầm chuyên nghiệp. Dự án được phát triển và tối ưu hóa dưới dạng Kỹ năng Tùy chỉnh (Custom Skill) cho IDE Antigravity.

## 🤖 Nhóm 5 Agent Cộng Tác
1. **Agent Ingestion (Thu thập)**: Tự động trích xuất nội dung chữ từ Web URL, RSS Feed, file PDF và Word (.docx).
2. **Agent Summarizer (Tóm tắt)**: Tóm tắt thông tin tài liệu thô nhanh chóng bằng Gemini API (Gemini 2.5 Flash) hoặc thuật toán dự phòng offline.
3. **Agent Copywriter (Biên tập)**: Soạn kịch bản video YouTube phân cảnh chi tiết (gồm Visual, Script lồng tiếng, gợi ý nhạc nền) cùng bài viết truyền thông ngắn.
4. **Agent Video Director (Dựng Video)**: Tạo phân cảnh Storyboard động, điều khiển giọng đọc nhân tạo (Speech Synthesis) Việt hóa kết hợp nhạc nền và hiệu ứng chuyển slide trực tiếp trên canvas trình duyệt.
5. **Agent Publisher (Tải lên)**: Thiết kế thumbnail ảnh bìa tự động (chọn tone màu neon/sunset/forest và viết chữ lên ảnh), tối ưu tiêu đề SEO và giả lập đẩy video lên YouTube.

## 🚀 Tính năng nổi bật
* **Lên lịch Cron tự động (Background Scheduler)**: Thiết lập giờ tự động nạp tin tức buổi sáng (e.g. 5:00 AM) và dựng/đăng video (e.g. 6:00 AM) chạy ngầm 24/7.
* **Giao diện công nghệ cao**: Bảng điều khiển Glassmorphism hiển thị trực quan sơ đồ luồng chạy và trạng thái hoạt động của từng Node Agent kèm nhật ký Logs thời gian thực.

## 🔧 Hướng dẫn Cài đặt & Khởi chạy

### Cài đặt thư viện
```bash
npm install
```

### Thiết lập File cấu hình
Tạo file `.env` từ file `.env.example` và điền khóa API Gemini:
```env
PORT=3000
GEMINI_API_KEY=your_gemini_api_key
```

### Khởi chạy Server
```bash
node server.js
```
Truy cập vào ứng dụng tại: **[http://localhost:3000](http://localhost:3000)**

---
Được phát triển bởi AI Assistant Antigravity.
