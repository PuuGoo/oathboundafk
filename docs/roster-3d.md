<!-- PROTOTYPE - NOT FOR PRODUCTION -->
# Roster Blender 3D

Tiếp nối Belinda: thêm 21 model procedural riêng cho các danh tính còn lại trong `OATHBOUND_HEROES`. Mỗi tướng có source Blender, GLB độc lập, provenance và bảy clip: `idle`, `run`, `basic`, `active`, `ultimate`, `hit`, `death`. Belinda giữ asset và generator cũ.

Đây là bản nghiên cứu nhân vật stylized bằng hình học sinh cục bộ. Trang phục, tóc và trang bị riêng được mô tả trong `tools/hero-models.json`; không phải mesh chính thức, không khẳng định sao chép chính xác hay đã được người dùng duyệt mỹ thuật. Quyền đối với thiết kế/danh tính nhân vật không tự phát sinh từ việc tạo mesh mới.

## File và tái dựng

- `tools/hero-models.json`: 21 cấu hình nhận diện, filename và ánh xạ hero ID thật. ID `celestial_guardian` vẫn là Lucius, `iron_bastion` là Hendrik, `dawn_oracle` là Palmer; không đổi ID/save.
- `tools/build-heroes.py`: dựng mesh, material, skin weights, armature và action bằng Blender 5.3.
- `assets-source/<tên>/<tên>.blend`: source có rig chỉnh sửa được, camera và đèn xem trước.
- `public/assets/models/<tên>.glb`: chỉ mesh/rig/animation, không chứa camera/đèn studio hoặc phụ thuộc texture ngoài.
- `public/assets/models/<tên>.provenance.json`: hash GLB, hash generator/config lúc dựng, số vertex/triangle và clip thực tế đọc từ GLB.
- `tools/render-hero-preview.py`: render một pose từ `.blend`, không sửa asset nguồn.
- `tools/verify-hero-models.mjs`: GLTFLoader và AnimationMixer thật, kiểm tra toàn roster hoặc tên được chọn.

Ví dụ Git Bash trên máy hiện tại:

```sh
'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background --threads 2 --python-exit-code 1 --python tools/build-heroes.py -- lucius --no-preview
'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe' --background --threads 2 --python-exit-code 1 --python tools/render-hero-preview.py -- lucius ultimate
node --import tsx tools/verify-hero-models.mjs
```

Chỉ chạy một Blender mỗi lần, CPU hai luồng; đo RAM trước từng nhóm. Lệnh không có `--no-preview` render thêm bốn pose và tốn thời gian hơn. `--python-exit-code 1` bắt lỗi script thành exit code khác 0.

## Model và animation

Estrilda có ngựa với xương cổ, đuôi và chân riêng (27 xương tổng). Các tướng mới còn lại có 17 xương, bao gồm đùi/cẳng chân, thân, đầu, tóc, áo/váy, cánh tay, cẳng tay và bàn tay. Skin weights rigid 100% theo bộ phận; không có mô phỏng vải/tóc, facial rig hoặc finger IK.

Nhận diện chính gồm khiên Lucius/Hendrik; súng đôi Raine; quan tài/nỏ Fawkes; kiếm Thane; túi hàng, bình thuốc và vịt Rowan; cung Gwyneth; chổi/khay trà Rosaline; song kiếm Cecilia; thùng bia Rigby; bộ vest/dao Oscar; quầng sáng Eluard; đồng hồ cát/bài Eluard thức tỉnh; váy/vương miện Peggy; shotgun Walker; sách/mắt Morrow; trượng tím Scarlet; khăn và kiếm gió Thane thức tỉnh; hoa hồng/kiếm Sonja; mũ, sách và quyền trượng Palmer.

Các clip dài 2 / 0,6 / 0,4 / 1,15 / 1,65 / 0,3 / 1,2 giây theo thứ tự nêu trên. Nhóm đầu có cast timeline từ simulation; các tướng chưa có timeline riêng dùng thời lượng trình diễn action hiện có. Animation chỉ trình diễn, không áp damage/cooldown/energy hoặc điều khiển simulation. Ngoài Belinda, hiệu ứng kỹ năng vẫn dùng hệ Canvas2D hiện tại; không khẳng định mọi phép đã chuyển sang mesh 3D.

Khớp rigid, áo và trang bị có thể giao nhau ở pose cực đoan. Các animation tái sử dụng ngôn ngữ chuyển động theo loại vũ khí, không khẳng định mỗi kỹ năng là một motion-capture riêng. Trong đoạn đầu animation gục, chân có thể thấp hơn mặt sàn khoảng 0,08 đơn vị model, tương tự Belinda hiện có.

## Kiểm tra asset thực tế

- 22/22 GLB khớp roster và source tồn tại, gồm 21 model mới và Belinda cũ.
- Mỗi model đủ bảy clip bắt đầu từ timestamp 0; đúng duration, có skin và không tải texture ngoài.
- 2.002 pose lấy mẫu bằng Three AnimationMixer, ma trận/bounds hữu hạn; không có skeleton vượt ngưỡng kiểm tra hình học.
- Clone skeleton độc lập và hash GLB khớp provenance.
- Tổng GLB của 22 model: 12.774.836 byte. Đây là dung lượng file, không phải mức RAM/GPU đo được.
- 21/21 ảnh đứng Blender được render; Lucius có thêm basic/ultimate/death.

Bằng chứng cục bộ: `production/qa/evidence/roster3d/asset-check.json`, `preview-index.json`, `roster-contact-sheet.jpg` và thư mục tên tướng. Công cụ thị giác của phiên làm việc đã trả lỗi 403; việc lưu ảnh không tự chứng minh đã duyệt chất lượng mỹ thuật.

## Renderer và kiểm tra runtime

`hero3d.ts` dùng chung một renderer WebGL 384×448 và hàng đợi tải từng GLB. Mỗi instance có skeleton/mixer độc lập, kể cả khi cùng tướng xuất hiện ở cả hai phe. Tướng đang tải hoặc bị lỗi dùng sprite cũ; lỗi một GLB không vô hiệu hóa các model khác. Reset trận giải phóng instance và model đã tải để cache không tăng theo toàn bộ roster. Load hoàn thành sau reset/unmount được giải phóng. Belinda giữ nguồn trượng và mesh phép cũ; API Belinda riêng vẫn tương thích.

`SpriteBattleCanvas` dùng backend này trong body pass đã sắp xếp độ sâu. Không thay simulation, ID, save hoặc hệ kỹ năng. `canvas.dataset.heroes3d` chỉ báo trạng thái model và instance thực sự được vẽ; `belinda3d`/`belindaSpells` vẫn phục vụ quan sát riêng Belinda. Không có API kích hoạt combat trong các dataset.

Kết quả chạy thực tế:

- 259/259 test đạt, không fail/skip; TypeScript đạt.
- Kiểm tra bổ sung với camera của backend: 22 GLB thật, 2.002 pose, không có primitive bị cắt khỏi khung tại các mẫu được kiểm tra. Không phải kết luận về mọi khung hình hoặc xuyên mesh.
- Production build đạt, có kiểm tra hash/dimension 22 sprite cũ và toàn bộ 22 model trước build. Cảnh báo Vite về `__dirname` và chunk lớn hơn 500 KB vẫn còn.
- Năm phiên Chrome production preview dùng năm đội khác nhau bao phủ đủ 22/22 hero ID. Từng hero được báo đã vẽ 3D trong trận; pause giữ nguyên pixel canvas và dữ liệu, chuyển ×2 được xác nhận. Các file JS/CSS/model được phục vụ khớp hash build.
- Phiên chặn riêng `lucius.glb`: cả hai Lucius không được đánh dấu vẽ 3D, các model khác (gồm Belinda) vẫn hoạt động; sprite fallback tiếp tục được gọi.
- Phiên LOW và media reduced-motion chạy thành công. Không có uncaught JavaScript exception trong bảy phiên; chỉ thấy `/favicon.ico` 404 sẵn có.
- Chạy lại observer Belinda sau tích hợp: basic/active và bốn nhóm impact ultimate đều được vẽ 3D, pause pixel/state ổn định, ×2 đạt, không exception. Kết quả nằm ở `production/qa/evidence/belinda3d/spells-normal-browser.json`.

`tools/verify-roster-runtime.mjs` dùng production preview loopback cổng 3002, Chrome profile tạm trong Hermes scratch và save giả; không đọc browser profile hay save thật. Chạy `npm run preview -- --host 127.0.0.1 --port 3002 --strictPort`, rồi `node --import tsx tools/verify-roster-runtime.mjs 0` đến `4`; thêm `--fallback` hoặc `--accessible` cho nhóm 0. Các báo cáo `group-*-browser.json` và ảnh PNG lưu trong evidence cục bộ. Ảnh đã được tạo nhưng chưa được agent duyệt bằng mắt do lỗi công cụ nêu trên. Không có kết luận về FPS/GPU tối thiểu, chất lượng chuyển động liên tục hoặc độ giống mỹ thuật.
