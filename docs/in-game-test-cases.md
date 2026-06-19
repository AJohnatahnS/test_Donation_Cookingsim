# เทสต์เคสในเกมจริง — Cooking Sim Donation Mod

ใช้ยืนยัน **พฤติกรรมตอนเล่นจริง** ที่ build/load พิสูจน์แทนไม่ได้ ทำในโหมด **Food Network career**

## เตรียมก่อนเริ่ม (Setup)

1. ติดตั้ง BepInEx 5.4.23.5 + วาง `CookingSimDonationMod.dll` ใน `BepInEx/plugins/` (ทำแล้ว)
2. `BepInEx/config/com.monitise.cookingsim.donation.cfg` → `[Game] UseSimulatedBridge = false`
3. รัน server: `node server.js` (หรือ `DONATION_STATE=...` ถ้าจะทดสอบ recovery)
4. เปิด overlay: `overlay.html` ในเบราว์เซอร์ (ดู queue/สถานะระหว่างเล่น)
5. ตัวยิงโดเนตปลอม (แนะนำ): **`node test-inject.js`** — REPL พิมพ์คำสั่งสดระหว่างเล่น
   (`support|standard|choice|priority|challenge|hard|boss`, `yt <thb>`, `tt <coins>`,
   `member`, `pick <n>`, `dupe`, `flood [n]`, `state|pending|stats`) หรือยิงทีเดียวจบ
   เช่น `node test-inject.js boss` / `node test-inject.js flood 5`
   (ทางเลือกอื่น: `node mock-source.js` ป้อนผ่าน adapter, หรือ POST เอง)
6. เปิดเกม → เข้าโหมด **Food Network** → เริ่มกะ (ให้มีออเดอร์ปกติของเกมเดินอยู่)

> ดู log ที่ `BepInEx/LogOutput.log` (บรรทัดขึ้นต้น `[Info :Cooking Sim Donation Mod]`)
> และ `GET /state`, `GET /stats` ของ server ควบคู่กัน

---

## A. Catalog ขับจากเกมจริง (mismatch #2)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| A1 | เข้าโหมด Food Network แล้วดู log + `GET /state` | mod ส่ง `POST /catalog` ด้วยสูตร Base Game จริง (`FoodnetworkDish`) — catalog **ไม่ว่าง** |
| A2 | ดู id/difficulty ใน catalog | id = `Recipe.CoreId.Id` (เลขจริง), difficulty ∈ easy/normal/hard map จากเกม |
| A3 | อยู่หน้าเมนูหลัก (ยังไม่เข้าโหมด) แล้วเช็ค `GetRecipeCatalog` | คืน null → server คงใช้ pool เดิม (ไม่ crash) |
| A4 | ตั้ง `difficultyOverrides` ใน config สำหรับ id หนึ่ง | สูตรนั้นถูก re-bucket ตาม override (§8) |

## B. สร้างออเดอร์ตามที่ผู้ชมเลือก (SetDebugRecipesOrder)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| B1 | ยิงโดเนต tier ที่ dispatch ทันที (ไม่ต้องเลือกเมนู) | ออเดอร์ของสูตรที่กำหนด **โผล่ในเกมเป็นออเดอร์ถัดไป** |
| B2 | จับเวลาตั้งแต่ dispatch → ออเดอร์โผล่ | โผล่ภายในจังหวะ `OrderLoop` ที่ยอมรับได้ (ไม่ค้าง) |
| B3 | ส่ง `recipeId` ที่ไม่มี/ไม่ใช่ Base Game | `TryCreateOrder` คืน false → server regenerate/สุ่มใหม่ (§5) ไม่ force ออเดอร์ผิด |
| B4 | ส่งสูตรที่ทำไม่ได้ในครัวปัจจุบัน | ตกไปทาง §5 (ลองตัวเลือกอื่น → regenerate 1 ครั้ง → FAILED) |

## C. หน้าต่างเลือกเมนูจาก chat (§4–5)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| C1 | โดเนต tier "Viewer Choice" | overlay เปิดหน้าต่างเลือก + แสดงตัวเลือกจาก catalog จริง |
| C2 | เจ้าของโดเนตพิมพ์ `1` / `!pick 2` ใน chat (`POST /chat`) | เลือกถูกคน (owner-by-userId) → ออเดอร์สูตรนั้นถูกสร้าง |
| C3 | คนอื่นพิมพ์เลข | ถูกเตือน 1 ครั้ง ไม่ถูกนับ |
| C4 | ไม่เลือกจนครบ 20 วิ | timeout → สุ่มสูตรให้อัตโนมัติ แล้วสร้างออเดอร์ |
| C5 | เปิดหน้าต่างซ้อน 2 โดเนต | ทีละหน้าต่าง (one-window-at-a-time) |

## D. คิว + เพดาน (§7, mismatch #1)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| D1 | ยิงโดเนตหลายอันรัวๆ | เกมรับ **ทีละ 1 ออเดอร์** (`maxConcurrentOrders=1`) ที่เหลือรอในคิว |
| D2 | ดู overlay/`GET /state` ตอนคิวยาว | นับคิวถูก ไม่เกิน cap (queue≤20, boss≤1) |
| D3 | โดเนตซ้ำ id เดิม (dedup) | ไม่สร้างซ้ำ |

## E. Timer / Pause (§6 — server ถือเวลา)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| E1 | ออเดอร์กำลังทำ แล้วกด **Pause** เกม | mod รายงาน `paused` → server หยุดนับเวลา (เวลาที่เหลือคงไว้) |
| E2 | กด Resume | นับต่อจากเวลาที่เหลือ ไม่รีเซ็ต |
| E3 | ออกไปเมนูหลักระหว่างมีออเดอร์ | mod รายงาน `menu` (จาก `!DuringGame`) → server pause |
| E4 | ปล่อยให้หมดเวลา | ออเดอร์ → `EXPIRED`, ส่ง `/finish` ถูก |

## F. จบ/ยกเลิกออเดอร์ (Harmony OrderEnd/OrderCancel)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| F1 | ทำออเดอร์โดเนตสำเร็จในเกม | `OrderEnd` ยิง → map กลับ eventId ถูก → `/finish COMPLETED` |
| F2 | ยกเลิก/ทิ้งจานออเดอร์โดเนต | `OrderCancel` ยิง → `/finish` สถานะ fail ถูก |
| F3 | ทำออเดอร์ปกติของเกม (ไม่ใช่โดเนต) สำเร็จ | **ไม่** ไปแตะ eventId ใด (ไม่มีใน `recipeToEvent`) |
| F4 | มีออเดอร์โดเนต + ออเดอร์เกมพร้อมกัน แล้วจบทีละอัน | map กลับถูกตัวด้วย `CoreId.Id` ไม่สลับ |

## G. State / Game lifecycle (`/game`)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| G1 | เข้า/ออกโหมดเล่น | `playing` ↔ `menu` รายงานถูก |
| G2 | ดูว่าจอโหลดทำให้รายงาน `menu` ผิดไหม | ⚠️ `!DuringGame` อาจ true ตอนโหลด — ยืนยันว่าไม่ทำ server สับสน |

## H. Crash recovery (§ persistence)

| # | ขั้นตอน | คาดหวัง |
|---|---|---|
| H1 | มีออเดอร์ค้างคิว แล้ว kill+restart `server.js` (ไม่ใช่ `DONATION_STATE=none`) | dedup ids + ออเดอร์ที่จ่ายเงินแล้ว survive → re-queue |
| H2 | mod ยังเปิดอยู่ตอน server restart | mod poll `/pending` ต่อได้ ไม่ค้าง |

---

## เกณฑ์ผ่าน
- A1, B1, F1 = **3 ข้อหลัก** ที่ปลดบล็อกการใช้งานจริง (catalog จริง / สร้างออเดอร์ / จบออเดอร์)
- E1–E3, G2 = ยืนยันสมมติฐาน `!DuringGame == menu` และ pause ตามสเปก §6
- ที่เหลือ = robustness ขอบเคส

> เมื่อผ่าน A1/B1/F1/E1–E3 ครบ → ลบ 4 ข้อ "ตรวจในเกม" ใน
> [cooking-sim-internals.md](cooking-sim-internals.md) "ผลการ verify" ได้
