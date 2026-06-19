# Mod ↔ Server Protocol

สัญญา HTTP ระหว่าง Cooking Simulator Mod (Unity/C#) กับ donation server
(`server.js`) Mod เป็นฝั่ง **poll** ไม่ต้องเปิด HTTP server ในเกม

Base URL เริ่มต้น: `http://127.0.0.1:3000`

## ภาพรวม lifecycle ของหนึ่งออเดอร์

```text
ผู้ชมโดเนต -> /event -> เข้าคิว -> (เลือกเมนู) -> DISPATCHED
Mod: GET /pending  -> เห็นออเดอร์
Mod: สร้างออเดอร์ในเกม
  สำเร็จ -> POST /confirm { ok: true }  -> COOKING (server เริ่ม timer ถ้าเป็น Priority+)
  ทำไม่ได้ -> POST /confirm { ok: false } -> server สุ่มเมนูใหม่ 1 ครั้ง (DISPATCHED) หรือ FAILED
เล่นจนเสร็จ -> POST /finish { outcome: "COMPLETED" }
หมดเวลา (timer ฝั่ง server) -> server จบออเดอร์เป็น EXPIRED เอง
```

## Endpoints ที่ Mod ต้องเรียก

### `GET /pending`
คืนออเดอร์ที่รอ Mod สร้างในเกม (state `DISPATCHED`) Mod ควร poll สม่ำเสมอ
(เช่นทุก 300–500ms)

```json
{ "pending": [
  { "eventId": "yt-abc", "tier": "PRIORITY", "recipe": "Beef Stew",
    "recipeId": "beef_stew", "donor": "Alice", "cookMinutes": 12 }
] }
```

จับคู่ `recipeId` กับสูตรใน Base Game `cookMinutes` เป็น `null` สำหรับ
Standard/Viewer Choice (ไม่มีเวลาจำกัด)

### `POST /confirm`
รายงานผลการสร้างออเดอร์ในเกม

```json
{ "eventId": "yt-abc", "ok": true }
```

- `ok: true` → ออเดอร์เข้าสู่ `COOKING` ถ้าเป็น Priority ขึ้นไป server เริ่มจับเวลา
  **ณ จุดนี้** (เวลาเลือกเมนู/รอคิวไม่ถูกนับ — §6)
- `ok: false` → server สุ่มเมนูใหม่ในระดับความยากเดิมหนึ่งครั้ง
  ออเดอร์กลับเป็น `DISPATCHED` (โผล่ใน `/pending` อีกครั้งพร้อม recipe ใหม่)
  ถ้าสุ่มใหม่ไม่ได้ → `FAILED_GAME_NOT_READY`

response: `{ "ok": true, "state": "COOKING" | "DISPATCHED" | "FAILED", ... }`

### `POST /finish`
รายงานผลสุดท้ายเมื่อเล่นจบออเดอร์ (server หยุด timer และคืน slot)

```json
{ "eventId": "yt-abc", "outcome": "COMPLETED" }
```

`outcome` ที่ถูกต้อง: `COMPLETED`, `EXPIRED`, `FAILED`, `CANCELLED`
(โดยปกติ Mod ส่ง `COMPLETED`; `EXPIRED` server จัดการเองเมื่อ timer หมด)

### `POST /game`
รายงานสถานะเกมเพื่อให้ server หยุด/เดินเวลาออเดอร์ (§6)

```json
{ "state": "playing" | "paused" | "menu" }
```

- `paused` / `menu` → หยุด timer ทุกออเดอร์ (เก็บเวลาที่เหลือ) และพักการดึงคิว
- `playing` → เดิน timer ต่อจากเวลาที่เหลือ และดึงคิวต่อ

### `POST /catalog`
แจ้ง catalog สูตรจริงของเกม (`Recipe.Id` ของ Base Game) ให้ server ใช้ขับ recipe
pool แทน `recipes.json` placeholder — Mod ส่งตอนเริ่ม และส่งซ้ำเมื่อ catalog
เปลี่ยน (ปลดล็อก/เปลี่ยนครัว) `makeable` มาจากเกม (unlocked + ทำได้ในครัวปัจจุบัน)
ส่วนการจัดกลุ่มความยากใช้ `difficulty` เป็นค่าตั้งต้น แล้ว server re-bucket ได้ด้วย
`config.recipePool.difficultyOverrides` ตาม §8

```json
{
  "recipes": [
    { "id": "101", "name": "Fried Eggs", "difficulty": "easy", "makeable": true },
    { "id": "210", "name": "Beef Wellington", "difficulty": "hard", "makeable": false }
  ]
}
```

ตอบกลับ `{ "ok": true, "count": <n> }` — array ต้องไม่ว่าง และทุกสูตรต้องมี `id`
กับ `name` เป็น string

## หมายเหตุการ implement ฝั่ง Unity

- อย่าใช้ `Time.timeScale = 0` เป็น timer — server ถือเวลาเองด้วย wall clock
  ใช้ `/game` แจ้ง pause แทน (§6)
- timer เริ่มที่ `/confirm` ไม่ใช่ตอน `/pending` — ยืนยันหลังออเดอร์ถูกสร้างจริง
- ออเดอร์เดียวกันถูกยืนยันได้ครั้งเดียว (`/confirm` ซ้ำจะ error)
- ปิด Mod แล้วต้องไม่แก้สถานะปลดล็อกสูตรในเซฟอย่างถาวร (ใช้ Runtime Unlock)
