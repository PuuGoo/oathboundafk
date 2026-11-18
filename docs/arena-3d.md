<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Sân đấu 3D

Lớp thứ ba sau model nhân vật và hiệu ứng kỹ năng: sân đấu được dựng trong Blender và vẽ đè lên ellipse Canvas2D, dùng chung WebGL context với nhân vật nên không mở thêm context GPU.

## Đường ống

- `tools/arena-themes.json`: một scene cho mỗi theme của campaign — `temple` (sanctuary), `forest` (sylvan), `shadow` (catacombs), `storm` (tempest), `obsidian` (obsidian). Gồm bảng màu sàn/viền/đạo cụ/phát sáng và `glow`.
- `tools/build-arena.py`: dựng sàn nhiều lớp, vành đá, cột + chậu lửa ở nửa xa, cờ, tường thành xa + hai tháp canh, hạt trôi, vòng pulse; gộp mọi mesh tĩnh cùng material rồi xuất GLB.

**Quy ước trục.** Mọi toạ độ trong `build-arena.py` viết theo hệ tác giả Y-up (`-Z` là hướng camera), rồi đổi sang hệ Blender Z-up qua `to_blender()`. Blender xuất với `export_yup=True` nên `(x, y, z)` thành `(x, z, -y)`; nếu đưa thẳng toạ độ tác giả vào Blender thì đài lửa và cột sẽ nằm ngang dưới sàn. Kích thước dùng `to_blender_extent()` (độ lớn, không đổi dấu).

Hậu cảnh (11 khối tường, đỉnh có lỗ châu mai, cửa sổ phát sáng, hai tháp canh, vòng cổng) dùng lại material sẵn có nên `join_static()` gộp vào 4 mesh tĩnh: **không thêm draw call**. Cao độ chọn theo phép chiếu thật để đỉnh tường nằm trong khung 480×680, không bị cắt mép trên.
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
- Sương khoảng cách chỉ thuộc scene sân: `THREE.Fog` bắt đầu ở camera-space depth 390–400 và đạt màu `secondary` của theme (kênh `ground` trong `arenaLighting`) ở depth 640–690; mỗi theme một cặp `near`/`far` trong `tools/arena-fog.json`. Tiền cảnh giữ tương phản; đá và kiến trúc phía xa hoà dần vào màu sân. `arena_glow`/`arena_ember` bỏ fog để rune, vòng sáng và lửa không bị chìm. Không đổi clear color hoặc nền trong suốt của renderer dùng chung, không thêm render target hay lượt composite.
- Regression lấy đỉnh GLB thật ở cả 5 sân, theo ma trận camera ở ba tỷ lệ khung khác nhau: 480×680 (12:17), 960×720 (4:3 desktop) và 420×600 (7:10): vùng đá phía trước nhận hệ số fog 0; hệ số trung bình của hậu cảnh nằm trong khoảng 0,15–0,5. Kiểm thêm đổi theme, reset, reduced-motion và đúng một `renderer.render` + một composite cho mỗi khung. Đây là kiểm tra hình học/cấu hình shader, không phải duyệt mỹ thuật.
- `node --import tsx tools/verify-arena-runtime.mjs <stage> <seconds> --verify-fog` kiểm thêm uniform `fogNear`/`fogFar`/`fogColor` tại lệnh WebGL đang vẽ trong profile QA riêng. Chỉ coi GPU đã xác minh khi lệnh này thực sự chạy đạt.
- Object thuộc clip `pulse` bị ẩn tay khi clip không chạy: mixer không lái transform của action bị tắt, nếu không vòng sáng sẽ đứng nguyên ở pose cuối. Test bắt đúng lỗi này.
- Vòng sáng pulse lấy màu chiêu: `ArenaFrame.pulseTint` mang `primary` của tướng vừa tung tuyệt kỹ (`heroVfxTint` đọc cùng `tools/hero-vfx.json` với hiệu ứng). Lúc vẽ, material của mesh `Pulse*` được pha 62 % sang màu đó ở cả `color` và `emissive`, rồi trả lại đúng màu accent của theme khi clip kết thúc. Rune, đài lửa, hạt sáng và `Idle halo` là material clone riêng nên giữ nguyên bảng màu; không thêm draw call hay lượt composite. Tướng không có GLB hiệu ứng thì không truyền tint và sân giữ màu theme.
- Cả sân bừng theo cùng nhịp: đèn chính `arena_sun` cộng thêm tối đa 1,6 cường độ (nền 1,5) và ngả `62 % × flash` sang màu chiêu, đèn viền `arena_rim` cộng 1,0 (nền 0,7) và ngả ít hơn; `flash` chính là `arenaPulseOpacity(progress)` của vòng pulse nên sáng lên và tan cùng lúc. Hết clip, cường độ và màu được ghi lại đúng giá trị gốc. Reduced motion không flash vì pulse không chạy. Không thêm đèn, shadow map hay render target — rig vẫn hai directional + một ambient.
- `hero3d.ts` gắn arena vào cùng backend, cùng `reset()`/`dispose()`. `canvas.dataset.arena3d` báo `{ scene, drawn, status, pulse }`; `drawn:false` nghĩa là nền 2D đang được dùng.
- Thân nhân vật bừng theo cùng nhịp: sau khi lớp sân vẽ được, `applyPulseFlash` lấy đúng `arenaPulseOpacity(pulseAge / 1,65)` và cộng vào rig riêng của nhân vật (key +2,2 trên nền 3,5; rim +1,4 trên nền 2; hemisphere +0,5 trên nền 2,5), pha màu chiêu 55 % vào key và 70 % mức đó vào rim. `reset()` và khung không có pulse trả rig về đúng bảng màu theme; reduced motion không flash. Không thêm đèn hay lượt render — vẫn là scene thân nhân vật dùng chung một buffer.
- Buffer dùng chung không còn cố định 384×448: `heroes3d.resize(cssWidth, cssHeight, dpr)` (gọi trong `resize()` của canvas) đặt chiều rộng buffer bằng `cssWidth × dpr`, kẹp trong 384–1024, và luôn giữ tỷ lệ 448/384 để khung cắt thân nhân vật không méo. Trước đây sân 3D ở cửa sổ 960 px bị phóng từ 384 px nên nhoè; nay buffer đi theo canvas (LOW preset giữ 1× cho máy yếu). Cùng một `renderer.setSize`, không thêm target hay pass; đo lại bằng `renderer.setSize` trong test, chưa đo FPS/GPU.

## Bằng chứng

- `verify-arena-models`: 5/5 GLB qua, 130 pose lấy mẫu, 3.855.876 byte tổng.
- Trong trận thật (Chrome production preview, save giả): stage 1 `temple`, stage 3 `shadow`, stage 4/5 `forest`, stage 6/7 `storm`, stage 9 `obsidian` — mỗi theme đều `drawn:true`, pause giữ pixel, ×2 vẫn vẽ, 0 exception. Lỗi 404 duy nhất là `/favicon.ico`.
- Lượt chạy lại trên bản dựng mới nhất (buffer theo canvas + flash sân + vệt đạn): stage 1 với `--verify-fog` đọc đúng `fogNear 400 / fogFar 640 / fogColor [0.553, 0.447, 0.314]` từ lệnh WebGL đang vẽ; stage 9 `obsidian` cũng `drawn:true`, pause ổn định, ×2 vẫn vẽ, 0 exception.
- 326/326 test, `tsc --noEmit` sạch, `vite build` đạt.

Giới hạn: chưa có duyệt mỹ thuật bằng mắt (công cụ xem ảnh trả 403 ở phiên này); chưa đo FPS/GPU, nên chưa biết buffer 1024 px ảnh hưởng bao nhiêu tới máy yếu; chưa kiểm mọi stage của campaign, chỉ một stage đại diện cho mỗi theme.
