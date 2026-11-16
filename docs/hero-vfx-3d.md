<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Hiệu ứng kỹ năng Blender 3D

Bước tiếp theo sau model nhân vật: mỗi tướng có một GLB hiệu ứng riêng, dựng bằng Blender và phát trong trận đấu thật. Hiệu ứng chỉ trình diễn — damage, cooldown, energy, mục tiêu và thời điểm va chạm vẫn do simulation quyết định.

## Đường ống

- `tools/hero-vfx.json`: nhận diện hiệu ứng từng tướng — `family`, màu `primary`/`secondary`/`accent`, `intensity`, ghi chú mỹ thuật.
- `tools/build-vfx.py`: dựng hình học phát sáng, material emissive và bốn clip keyframe object (`basic` 0,4 s · `active` 1,15 s · `ultimate` 1,65 s · `impact` 0,45 s) rồi xuất GLB.
- `assets-source/vfx/<tên>/<tên>.blend`: source chỉnh sửa được, có camera/đèn xem trước.
- `public/assets/vfx/<tên>.glb`: chỉ mesh/material/animation; không camera, đèn studio hay texture ngoài.
- `public/assets/vfx/<tên>.provenance.json`: hash GLB, hash generator/spec, số object/vertex/triangle và clip thực tế đọc từ GLB.
- `tools/verify-vfx-models.mjs`: GLTFLoader + AnimationMixer thật, kiểm tra clip, timestamp, channel, bounds và hash; đọc thêm coverage pixel của ảnh preview Blender.
- `tools/verify-vfx-runtime.mjs`: production preview trong Chrome profile tạm, đọc `canvas.dataset.heroVfx`.

```sh
'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background --threads 2 \
  --python-exit-code 1 --python tools/build-vfx.py -- belinda
node --import tsx tools/verify-vfx-models.mjs belinda
```

Một Blender mỗi lần, hai luồng CPU; bỏ `--no-preview` sẽ render thêm bốn ảnh PNG vào `production/qa/evidence/vfx3d/<tên>/`.

## Họ hiệu ứng

Bảy họ hình học, mỗi họ có tổ hợp part khác nhau và tham số theo tướng:

| family | Nhận diện | Dùng cho |
|---|---|---|
| `sigil` | nhiều vành xoay, nan chữ, lõi sao, hạt sáng bay | pháp sư / thánh quang |
| `strike` | ba lưỡi liềm quét, mảnh vụn, vòng va chạm | kiếm / chém |
| `lance` | mũi lao dài, dải xoắn, vòng nổ điểm chạm | thương / giáo |
| `volley` | nhiều mũi tên cung, vệt, vòng chạm | cung thủ |
| `bloom` | cánh hoa nở, cột sáng, hạt chữa trị | hồi máu / buff |
| `storm` | tia chớp tỏa, cầu lệch tâm, vành xung kích | sát thương phép |
| `gunfire` | chớp đầu nòng, vệt đạn, vòng xung kích | súng |

Material được đặt tên cố định `vfx_core`, `vfx_glow`, `vfx_alt`, `vfx_halo`; runtime đọc tên để gán hệ số mờ riêng (halo mờ nhất) và `low` preset giảm tiếp lớp halo.

## Runtime

- `src/game/heroVfx.ts`: chọn clip theo `skillSlot` thật (`basic`/`active`/`ultimate`). Chỉ damage outcome dùng clip `impact`; heal/shield/control/mark giữ art Canvas có ý nghĩa riêng. Phase lấy từ `CombatTimeline` khi có, còn lại theo thời lượng trình diễn, không khẳng định là contact marker của engine. Mỗi batch tối đa 8 hiệu ứng; phần vượt giới hạn giữ Canvas.
- `src/game/heroVfx3d.ts`: một scene, một camera ortho khớp khung canvas, pool instance theo `effect.id`. Mỗi layer pass render **một lần** rồi composite vào Canvas2D; effect không xử lý được giữ nguyên art Canvas2D.
- `hero3d.ts`: `drawSpells` thử GLB trước, sau đó mới tới hiệu ứng Belinda cũ, nên asset lỗi/đang tải không làm mất hiệu ứng nào.
- Thời gian animation đặt bằng `mixer.setTime` từ tuổi effect; pause và ×2 theo đồng hồ trận đấu. Reduced-motion dùng pose tĩnh trong GLB; LOW giảm lớp halo. Pool tối đa 16 instance, giải phóng material riêng khi loại instance và cache khi đổi trận. Hiệu ứng damage đã phát có thể tiếp tục sau khi caster chết; không phải death freeze.

## Trạng thái hiện tại

- Danh sách đang bật là `HERO_VFX_DEFINITIONS` trong `src/game/heroVfx.ts`; prebuild đối chiếu với `tools/hero-vfx.json` và GLB/source thật. Các tướng được bổ sung theo từng commit riêng.
- Báo cáo runtime lưu theo tên đội hình, phân biệt id do GLB vẽ với hiệu ứng Belinda cũ. `seen`/`all` đếm khung hình lấy mẫu; `uniqueEffects` đếm effect id duy nhất. Các con số `seen` trong commit ban đầu không phải số lần tung chiêu. Đặc biệt bản quan sát Hendrik trước đó chỉ ghi nhận cast basic bằng GLB, impact basic của Hendrik ở lượt đó vẫn là Canvas.
- Asset được kiểm tra bằng công cụ thật; ảnh preview Blender được tạo nhưng công cụ thị giác của phiên làm việc trả lỗi 403, nên **chưa có phê duyệt mỹ thuật bằng mắt**. Coverage pixel chỉ chứng minh có hình sáng được render, không chứng minh "đẹp".
- Chưa đo FPS/GPU tối thiểu; giới hạn 8 hiệu ứng/layer là để chặn chi phí chứ chưa phải kết quả đo hiệu năng.
