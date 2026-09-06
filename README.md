# ImagePrompt01 — Prompt Gallery

Bộ sưu tập prompt + ảnh sinh từ `08_prompts_for_manual_image_generation.txt` (179 block, `IMG_001` → `IMG_179`), kèm website tĩnh để duyệt, tìm kiếm và tải ảnh.

## Stack

- **Website:** Vite + React + TypeScript + Tailwind CSS v4 (static, không backend)
- **Ảnh:** WebP (chất lượng 85, cạnh dài tối đa 1536px, giữ tỉ lệ, không upscale)
- **Xử lý ảnh:** sharp (Node)
- **Nguồn ảnh hiện tại:** sinh bằng **công cụ sinh ảnh tích hợp của Arena.ai Agent Mode** (không dùng API key ngoài, không yêu cầu key của bạn). Trình sinh là mô hình ảnh trực tiếp trong môi trường; workflow cụ thể không thể chạy lại bằng script API — script ở dưới là để bạn tự chạy lại khi thêm prompt mới, hoặc dùng API key của riêng bạn.

## Chạy local

```bash
npm install
npm run dev        # dev server (tự chạy parse-prompts + sync ảnh vào public/images)
```

Mở URL do Vite in ra. Để preview bản build:

```bash
npm run build
npm run preview
```

## Cấu trúc

```
08_prompts_for_manual_image_generation.txt   # nguồn prompt (đừng sửa đổi nếu không cần)
scripts/parse-prompts.mjs                    # parse file → public/prompts.json
scripts/generate-images.mjs                  # gọi image API (env) → raw/<ID>.png
scripts/process-images.mjs                   # raw → images/<ID>__<slug>.webp + manifest.json
scripts/sync-public-images.mjs               # images/ → public/images/ (để site phục vụ ảnh)
images/                                      # ảnh WebP + manifest.json + failed.json (đã commit)
public/prompts.json                          # dữ liệu prompt cho site
src/                                         # website React
.github/workflows/deploy-pages.yml           # build + deploy GitHub Pages
```

## Các script

### 1) Parse prompt

```bash
npm run parse
# hoặc: node scripts/parse-prompts.mjs
# tuỳ chọn: --source=<file> --out=<path>
```

In ra: tổng số block, ID đầu/cuối, ID thiếu negative prompt, cảnh báo trùng/lỗi liên tục. Chịu lỗi CRLF, khoảng trắng thừa, thiếu/thừa dòng trống, block cuối không kết thúc bằng dòng trống.

### 2) Sinh lại ảnh qua API (dùng khi bạn thêm prompt mới)

```bash
cp .env.example .env   # điền IMAGE_API_KEY (không bao giờ commit .env)
npm run generate       # hoặc node scripts/generate-images.mjs
```

Cờ CLI:

| Cờ | Ý nghĩa |
|---|---|
| `--range=IMG_010..IMG_050` | Sinh một dải ID liên tục |
| `--only=IMG_007,IMG_012` | Sinh các ID cụ thể |
| `--force` | Sinh lại kể cả khi ảnh đã tồn tại |
| `--concurrency=3` | Số request song song (mặc định 3) |
| `--dry-run` | Chỉ in ra những gì sẽ làm, không gọi API |

Mặc định bỏ qua ID đã có ảnh trong `images/manifest.json`. Sau khi sinh, chạy:

```bash
npm run process:images
```

Biến môi trường (xem `.env.example`):

- `IMAGE_API_KEY` — bắt buộc. Đọc từ env, **không hardcode, không commit** (`.env` nằm trong `.gitignore`).
- `IMAGE_API_BASE_URL` — mặc định `https://api.openai.com/v1`
- `IMAGE_API_MODEL` — mặc định `gpt-image-1`
- `IMAGE_SIZE` — mặc định `1536x1024` (kích thước phía API; bước process chuẩn hoá về cạnh dài ≤1536)
- `IMAGE_NEGATIVE_PROMPT_AS_TEXT=1` — nối negative prompt vào prompt dưới dạng "Avoid in the image…" (API không có tham số negative riêng)

> Ghi chú: công cụ tích hợp đã sinh ảnh hiện tại **không hỗ trợ tham số negative prompt riêng**, nên `negative_prompt_applied: false` trong manifest. Negative prompt được giữ nguyên văn trong manifest để bạn đối chiếu; prompt chính nguồn vốn đã chứa các điều khoản loại bỏ (`no text, no letters, no numbers`). Script API ở trên có thể bật `IMAGE_NEGATIVE_PROMPT_AS_TEXT=1` để nối negative prompt vào prompt dưới dạng "Avoid in the image…".

### 3) Xử lý ảnh

```bash
npm run process:images
# tuỳ chọn: --only=IMG_001,IMG_005 --force --max-edge=1536 --quality=85
```

- Định dạng **WebP, chất lượng 85**, cạnh dài tối đa **1536px**, giữ tỉ lệ, không upscale.
- Tên file: `<ID>__<slug>.webp` (slug = 6–8 từ đầu prompt, bỏ dấu, lowercase, không phải `a-z0-9` → `-`, gộp dấu gạch, tối đa 60 ký tự).
- Ghi `images/manifest.json` (generated_at, generator, items với id/filename/prompt/negative_prompt/negative_prompt_applied/width/height/bytes/created_at).
- Nếu ảnh nào lỗi → ghi `images/failed.json` và tiếp tục.
- Nếu tổng `images/` vượt **200 MB**, tự động chạy lại toàn bộ với **WebP q80 + cạnh dài 1280px**.

## Deploy

### GitHub Actions → GitHub Pages (khuyên dùng)

Repo đã có `.github/workflows/deploy-pages.yml`:

1. Trong **Settings → Pages**, chọn nguồn **GitHub Actions**.
2. Push (hoặc merge) lên nhánh `feat/prompt-gallery` — workflow tự build (`npm run build`: parse prompts → sync ảnh → vite build) rồi deploy `dist/` lên Pages.
3. Workflow cũng chạy được thủ công từ tab **Actions** (`workflow_dispatch`).

### Deploy tay

```bash
npm run build
# dist/ chứa site tĩnh hoàn chỉnh; đưa lên bất kỳ static host nào (Netlify, Vercel, S3, …)
```

## Ghi chú triển khai

- `public/images/`, `raw/`, `node_modules/`, `dist/`, `.env` đều bị git-ignore; nguồn thật là `images/` (đã commit).
- Tổng `images/` hiện tại **~2 MB** (10/179 ảnh đã sinh) — dưới ngân sách 200 MB, giữ nguyên q85/1536px.
- Trạng thái: **10/179 ảnh đã sinh** (IMG_001–IMG_010). Các ID còn lại đang hiển thị placeholder trên site.
