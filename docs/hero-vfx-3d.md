<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Hiệu ứng kỹ năng Blender 3D

Bước tiếp theo sau model nhân vật: mỗi tướng có một GLB hiệu ứng riêng, dựng bằng Blender và phát trong trận đấu thật. Hiệu ứng chỉ trình diễn — damage, cooldown, energy, mục tiêu và thời điểm va chạm vẫn do simulation quyết định.

## Đường ống

- `tools/hero-vfx.json`: nhận diện hiệu ứng từng tướng — `family`, màu `primary`/`secondary`/`accent`, `intensity`, ghi chú mỹ thuật.
- `tools/register-vfx-hero.mjs`: thêm một tướng vào manifest sau khi đối chiếu `sourceId` với roster; runtime đọc **cùng** manifest nên không có danh sách bật thứ hai để quên.
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

Material được đặt tên cố định `vfx_core`, `vfx_glow`, `vfx_alt`, `vfx_halo`; runtime đọc tên để gán hệ số mờ riêng (halo mờ nhất) và `low` preset giảm tiếp lớp halo. Runtime dựng lại mỗi material thành **MeshBasicMaterial cộng sáng** mang màu `emissive` đã tác giả trong Blender, không ghi depth: hiệu ứng cộng ánh sáng vào sân thay vì phủ một lớp đục che tướng phía sau.

Tổng độ sáng của một lớp có ngân sách (`VFX_STYLE.brightnessBudget`, chi phí = độ mờ × bình phương độ lớn). Khi nhiều tướng cùng tung chiêu vượt ngân sách, cả lớp giảm đều qua `sample.brightness` thay vì cháy trắng; runtime áp hệ số đó vào `material.opacity` thật.

## Runtime

- `src/game/heroVfx.ts`: chọn clip theo `skillSlot` thật (`basic`/`active`/`ultimate`). Chỉ damage outcome dùng clip `impact`; heal/shield/control/mark giữ art Canvas có ý nghĩa riêng. Phase lấy từ `CombatTimeline` khi có, còn lại theo thời lượng trình diễn, không khẳng định là contact marker của engine. Mỗi batch tối đa 8 hiệu ứng; phần vượt giới hạn giữ Canvas.

**Đường đi theo họ chiêu** (`travelMode`, suy từ `family` trong manifest): `sigil`/`bloom`/`storm` là **aura** — nở tại chỗ quanh người niệm, `travel` luôn 0; `strike` là **melee** — nhát chém nằm ngay trên mục tiêu, `travel` 1; `gunfire`/`volley`/`lance` là **projectile** — bay từ nòng tới mục tiêu theo cung parabol, và cung chỉ áp cho phase `flight`. Trước đây mọi họ đều bay sang địch, nên hào quang thánh lại phóng qua sân.
- `src/game/heroVfx3d.ts`: một scene, một camera ortho khớp khung canvas, pool instance theo `effect.id`. Mỗi layer pass render **một lần** rồi composite vào Canvas2D; effect không xử lý được giữ nguyên art Canvas2D. Lớp `front` thêm **một** lượt composite nữa: `globalCompositeOperation = 'lighter'`, `filter = blur(6px)`, alpha .34, phóng 8 px mỗi phía để ánh sáng loang ra (halo/bloom). Khi trong batch có **tuyệt kỹ**, thêm một lớp sương thứ hai `blur(14px)`, alpha .20, phóng 22 px — vẫn từ đúng buffer đó nên không có render thứ hai; đòn thường giữ chi phí cũ. Các lượt này bị bỏ ở `low` preset, reduced-motion và khi môi trường không có `ctx.filter`; trạng thái canvas của caller được `save()`/`restore()`.
- `hero3d.ts`: `drawSpells` thử GLB trước, sau đó mới tới hiệu ứng Belinda cũ, nên asset lỗi/đang tải không làm mất hiệu ứng nào.
- `heroVfxTint` trả `primary` trong `tools/hero-vfx.json`; `SpriteBattleCanvas` gắn màu đó vào `ArenaFrame.pulseTint` của lần tung tuyệt kỹ gần nhất, nên vòng sáng dưới sàn đổi theo tướng (xem `docs/arena-3d.md`). Đây là màu trình diễn dùng chung manifest, không phải dữ liệu sát thương.
- Đòn chạm để lại vệt tan trên sàn: khi effect `impact` hết tuổi, instance giữ nguyên pose cuối thêm **0,55 s đồng hồ trình diễn** (`HeroVfxFrame.clock`, chính `visualClock` nên pause/×2 áp đúng) rồi mờ dần theo bình phương, chỉ vẽ lại đúng layer mà nó đã đặt. Không tạo mesh/material mới, không thêm render; reduced motion không để vệt.
- Thời gian animation đặt bằng `mixer.setTime` từ tuổi effect; pause và ×2 theo đồng hồ trận đấu. Reduced-motion dùng pose tĩnh trong GLB; LOW giảm lớp halo. Pool tối đa 16 instance, giải phóng material riêng khi loại instance và cache khi đổi trận. Hiệu ứng damage đã phát có thể tiếp tục sau khi caster chết; không phải death freeze.
- `canvas.dataset.heroVfx.rendered3d` chỉ bật khi **GLB** đã vẽ id đó; `dataset.heroes3d` là model thân nhân vật, `dataset.belindaSpells` là hiệu ứng Belinda cũ — ba nguồn không thay thế nhau.

## Trạng thái hiện tại

### Đính chính sau rà soát runtime

- Đã sửa recovery để projectile giữ điểm chạm thay vì nhảy về nguồn; regression dùng GLB thật thất bại trước sửa và đạt sau sửa. Caster và recipient được cập nhật theo instance cho toàn bộ hero có hiệu ứng, gồm Estrilda đang lao tới.
- Các lượt Chrome hiện tại xác nhận cờ tốc độ ×2 và hiệu ứng tiếp tục được vẽ, chưa đo tiến độ animation của cùng một effect để chứng minh tỷ lệ thời gian gấp đôi.
- `pauseStableFrom` là chỉ số **ảnh lấy mẫu**, cách nhau khoảng 350 ms, không phải chỉ số frame render. Quan sát ảnh đầu khác rồi các ảnh sau ổn định chưa xác định nguyên nhân; diễn giải trước đó là “một frame trễ” chưa được chứng minh. Probe pause sớm cũng chưa bắt buộc có GLB kỹ năng đang hiện.
- Sau bản sửa recovery/anchor: 277/277 test và build đạt. Đã chạy lại Chrome production preview với Estrilda, Lucius, Raine, Belinda, Fawkes: mỗi hero có id GLB thực sự được vẽ, không exception; screenshot pause ổn định theo các mốc lấy mẫu. Đây là smoke test GPU, không phải duyệt bằng mắt hay phép đo chuyển động chính xác trên GPU.

- **22/22 danh tính** trong `OATHBOUND_HEROES` có GLB hiệu ứng riêng, `.blend` nguồn và provenance; mỗi tướng được push thành một commit riêng.
- Kiểm tra asset một lượt cho cả roster: 22/22 GLB qua, 968 pose lấy mẫu bằng `AnimationMixer`, tổng **7.432.424 byte** GLB. Đây là dung lượng file, không phải RAM/GPU đo được.
- Probe runtime kiểm pause/×2 **ngay khi trận mở**, vì stage 1 có thể kết thúc trước cửa sổ quan sát. Pause được kiểm bằng 5 ảnh cách nhau khoảng 350 ms: đồng hồ simulation và tuổi effect đứng yên, canvas ổn định từ ảnh thứ hai trở đi; `pauseStableFrom` ghi rõ mốc lấy mẫu. Điều này không chứng minh độ trễ một frame render. Sau đó probe bật ×2 và ghi số hiệu ứng còn được vẽ (`x2DrawnAtEnd`), chưa đo tỷ lệ tiến độ animation.
- Mỗi lượt chỉ chạy một formation 5 tướng; chưa có lần chạy nào quan sát đủ 22 tướng trong **một** trận. Mỗi tướng đã được xác nhận trong ít nhất một formation, nhưng không phải mọi slot (basic/active/ultimate) của mọi tướng đều đã xuất hiện trong bằng chứng.
- Asset được kiểm tra bằng công cụ thật; ảnh preview Blender được tạo nhưng công cụ thị giác của phiên làm việc trả lỗi 403, nên **chưa có phê duyệt mỹ thuật bằng mắt**. Coverage pixel chỉ chứng minh có hình sáng được render, không chứng minh "đẹp".
- Chưa đo FPS/GPU tối thiểu; giới hạn 8 hiệu ứng/layer là để chặn chi phí chứ chưa phải kết quả đo hiệu năng.
