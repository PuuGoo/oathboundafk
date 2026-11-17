<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Sân đấu 3D

Lớp thứ ba sau model nhân vật và hiệu ứng kỹ năng: sân đấu được dựng trong Blender và vẽ đè lên ellipse Canvas2D, dùng chung WebGL context với nhân vật nên không mở thêm context GPU.

## Đường ống

- `tools/arena-themes.json`: một scene cho mỗi theme của campaign — `temple` (sanctuary), `forest` (sylvan), `shadow` (catacombs), `storm` (tempest), `obsidian` (obsidian). Gồm bảng màu sàn/viền/đạo cụ/phát sáng và `glow`.
- `tools/build-arena.py`: dựng sàn nhiều lớp, vành đá, cột + chậu lửa ở nửa xa, cờ, hạt trôi, vòng pulse; gộp mọi mesh tĩnh cùng material rồi xuất GLB.
- `assets-source/arenas/<id>/<id>.blend`: source chỉnh sửa được.
- `public/assets/arenas/<id>.glb`: hai clip `idle` 4 s (loop: lửa nhấp nháy, cờ lay, hạt trôi) và `pulse` 1,65 s (vòng sáng lan khi tung tuyệt kỹ).
- `public/assets/arenas/<id>.provenance.json`: hash GLB/generator/spec, số object, mesh, vertex, triangle.
- `tools/verify-arena-models.mjs`: GLTFLoader + AnimationMixer thật; kiểm clip, timestamp, bounds, hash và ngân sách draw call.
- `tools/verify-arena-runtime.mjs`: production preview trong Chrome profile tạm; kiểm hash GLB được phục vụ, `canvas.dataset.arena3d`, pause và ×2.

```sh
'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background --threads 2 \
  --python-exit-code 1 --python tools/build-arena.py -- temple
node --import tsx tools/verify-arena-models.mjs
node --import tsx tools/verify-arena-runtime.mjs 1 12
```

## Ngân sách hình học

Lần dựng đầu ra 110 mesh cho một sân (74% trong số đó là viền đá và nan chữ tĩnh). Với 5 theme thì đó là hơn 500 draw call chỉ cho nền, quá nhiều với máy 8 GB dùng GPU tích hợp. `join_static()` gộp mọi mesh tĩnh cùng material, còn 39 mesh/sân:

| | trước | sau |
|---|---|---|
| mesh | 110 | 39 |
| GLB | 761 KB | 771 KB |
| tĩnh | 75 | 4 |

Mesh tĩnh gộp lại thì GLB **không nhỏ đi** — dữ liệu đỉnh vẫn thế, chỉ gộp buffer. Cái giảm là số draw call, không phải dung lượng.

## Khớp ellipse thay vì khớp góc camera

Sàn Canvas2D là ellipse `width*0.66 × height*0.31`, tỷ lệ **0,665**. Camera studio dùng để dựng GLB không được export, nên runtime phải tự suy góc nghiêng:

- Đĩa bán kính `R` nhìn qua camera ortho nghiêng `e` cho ellipse có bán trục dọc `R·sin(e)`. Vì vậy `elevationForEllipse = asin(radiusY / radiusX)`.
- Camera đặt ở `(0, sin(e)·d, cos(e)·d)` và xoay `-e` quanh X. Dùng `PI/2 - e` sẽ khiến camera nhìn chếch lên và sàn trôi khỏi khung — lỗi này đã xảy ra và được test `project()` bắt.
- Mỗi world-unit bằng một pixel theo trục X (`perPixel = 100 / radiusX`), nên đĩa 100 bán kính phủ đúng `radiusX` pixel; tâm ellipse đặt bằng `shiftX`/`shiftY`.
- Test khẳng định **bốn mép** đĩa rơi đúng ellipse ở ba kích thước canvas. Đây là kiểm tra số học trên ma trận thật, không phải đọc ảnh.

## Runtime

- `src/game/arena3d.ts`: phân giải theme → scene, override của người chơi thắng theme stage, và sampling clip. `sampleArenaPulse` trả `pulse` khi có tuổi tuyệt kỹ < 1,65 s, còn lại `idle`; reduced motion đóng băng vòng idle nhưng **không** đóng băng pulse.
- `src/game/arenaScene3d.ts`: một scene, một camera dùng lại; renderer mượn của backend nhân vật. Mỗi frame **một** `renderer.render` rồi `drawImage` vào canvas 2D. Asset đang tải/lỗi trả `false` và Canvas2D giữ nền ellipse phẳng.
- Object thuộc clip `pulse` bị ẩn tay khi clip không chạy: mixer không lái transform của action bị tắt, nếu không vòng sáng sẽ đứng nguyên ở pose cuối. Test bắt đúng lỗi này.
- `hero3d.ts` gắn arena vào cùng backend, cùng `reset()`/`dispose()`. `canvas.dataset.arena3d` báo `{ scene, drawn, status, pulse }`; `drawn:false` nghĩa là nền 2D đang được dùng.

## Bằng chứng

- `verify-arena-models`: 5/5 GLB qua, 130 pose lấy mẫu, 3.855.876 byte tổng.
- Trong trận thật (Chrome production preview, save giả): stage 1 `temple`, stage 3 `shadow`, stage 4/5 `forest`, stage 6/7 `storm`, stage 9 `obsidian` — mỗi theme đều `drawn:true`, pause giữ pixel, ×2 vẫn vẽ, 0 exception. Lỗi 404 duy nhất là `/favicon.ico`.
- 291/291 test, `tsc --noEmit` sạch, build đạt kèm cổng `verify:arena-models`.

Giới hạn: chưa có duyệt mỹ thuật bằng mắt (công cụ xem ảnh trả 403); chưa đo FPS/GPU; chưa kiểm mọi stage của campaign, chỉ một stage đại diện cho mỗi theme.
