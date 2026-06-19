# Cooking Sim Donation Mod (BepInEx)

ฝั่งเกมของระบบโดเนต — BepInEx plugin (Unity Mono) ที่คุยกับ donation server
ตาม [../docs/mod-protocol.md](../docs/mod-protocol.md)

## สถานะ

| ส่วน | สถานะ |
|---|---|
| ชั้นโปรโตคอล (poll `/pending`, `/confirm`, `/finish`, `/game`, `/catalog`) | ✅ เขียนครบ |
| `SimulatedGameBridge` (ทดสอบกับ server โดยไม่ต้องมีเกม) | ✅ ใช้งานได้ |
| `CookingSimGameBridge` + `GameHooks` (ต่อเกมจริง) | ✅ **build + โหลดในเกมจริงสำเร็จ** (Harmony patch ครบ) |
| พฤติกรรมตอนเล่น Food Network จริง | 🟡 เหลือยืนยัน 4 ข้อ (ดู internals "ผลการ verify") |

✅ **2026-06-19**: คอมไพล์กับ `Assembly-CSharp.dll` จริง (0 warning/error) และโหลดผ่าน
BepInEx 5.4.23.5 ในเกมจริง (Unity 2022.3) ด้วย `UseSimulatedBridge=false` —
`Harmony.PatchAll()` ผูก patch ครบทุกจุดโดยไม่มี exception. API จริงที่ปรับจาก draft:
`OrderEnd`/`OrderCancel` เป็น private (patch ด้วย string), `GameManager.Paused`/`DuringGame`
เป็น static (สรุปสถานะจาก static ล้วน), ใช้ `Recipe.CoreId.Id` (ไม่ใช่ `Id` ที่ deprecated),
`RecipeDifficulty` อยู่ namespace `Recipes`, `JsonUtility` ต้องอ้างอิง `JSONSerializeModule`.
ดูรายละเอียด + 4 ข้อที่เหลือยืนยันที่ [../docs/cooking-sim-internals.md](../docs/cooking-sim-internals.md)

> ✅ มิสแมตช์ 2 เรื่องกับเกมจริงแก้แล้ว: (1) `config.queue.maxConcurrentOrders = 1`
> (Base career เสิร์ฟทีละออเดอร์); (2) Mod ส่ง catalog สูตรจริงผ่าน `/catalog`
> และ `recipeId` คือ `Recipe.Id` จริงของเกม (ขับ recipe pool จากเกม ไม่ใช่
> `recipes.json` placeholder) — เหลือแค่ยืนยันบรรทัด VERIFY ในเกมจริง

## โครงสร้าง

```
src/
  Plugin.cs                 จุดเข้า BepInEx + config
  DonationRuntime.cs        loop หลัก: poll -> create -> confirm, ส่ง event ต่อ
  ProtocolClient.cs         client ของทุก endpoint (UnityWebRequest + JsonUtility)
  Dtos.cs                   wire types
  IGameBridge.cs            seam ระหว่างโปรโตคอลกับเกม
  SimulatedGameBridge.cs    เกมจำลองสำหรับทดสอบ
  CookingSimGameBridge.cs   ตัวจริง (stub พร้อมจุดต่อ)
```

## Build

ต้องมี .NET SDK + BepInEx 5 (x64, Mono) ติดตั้งในโฟลเดอร์เกม csproj อ้างอิง DLL
จากตัวที่ติดตั้ง (เกม + `BepInEx\core`) ไม่พึ่ง NuGet — และตั้ง path เครื่องนี้
(`D:\Game\steamapps\common\CookingSimulator`) เป็น default:

```powershell
dotnet build mod/CookingSimDonationMod.csproj -c Release
# ย้ายเครื่อง/เกมที่อื่น override ด้วย:
#   -p:GameDir="C:\...\steamapps\common\CookingSimulator"
```

ได้ `bin\Release\CookingSimDonationMod.dll` แล้วคัดลอกไป `BepInEx\plugins\`
(ติดตั้ง [BepInEx 5 (x64, Mono)](https://github.com/BepInEx/BepInEx/releases) ก่อน — ทดสอบกับ 5.4.23.5)

> `mod/nuget.config` ล้าง package sources + fallback folders ไว้ เพราะ machine-wide
> NuGet.Config ของเครื่องนี้ชี้ fallback folder ที่หายไป (`D:\program\VS\SS\NuGetPackages`)
> ซึ่งทำให้ `ResolvePackageAssets` crash ตอน build

## ทดสอบโดยไม่ต้องมีเกม

ค่าเริ่มต้นใช้ `SimulatedGameBridge` (config `Game.UseSimulatedBridge = true`)
ทำให้รันคู่กับ server ได้เลยเพื่อตรวจสายสื่อสาร:

1. `node server.js`
2. `node mock-source.js` — ป้อนโดเนต (Viewer Choice ขึ้นไปต้องมีคนกดเลือกเมนูใน chat ก่อน จึงจะถูก dispatch)
3. โหลด plugin ในเกม (หรือรันโลจิกเดียวกันในโปรเจกต์ทดสอบ) — มันจะ poll `/pending`,
   ยืนยันออเดอร์, "ทำอาหาร" `SimulatedCookSeconds` วินาที แล้วส่ง `/finish COMPLETED`

> หมายเหตุ: integration test ฝั่ง Node (`node integration.js`, scenario S8) จำลอง
> พฤติกรรม Mod เดียวกันนี้ผ่าน HTTP อยู่แล้ว — ใช้ตรวจ contract ได้โดยไม่ต้อง build C#

## ต่อเข้าเกมจริง (เหลือทำ)

เติมใน `CookingSimGameBridge.cs`:

- `TryCreateOrder` — สร้างออเดอร์ในเกมสำหรับ `recipeId` ใช้ **Runtime Unlock**
  (ห้ามเขียนสถานะปลดล็อกลงเซฟถาวร — สเปกข้อ 1) ตรวจว่าทำได้ในครัวปัจจุบันก่อน
  ถ้าไม่ได้ให้ return false (server จะสุ่มเมนูใหม่ให้ 1 ครั้ง)
- `OrderCompleted` / `OrderFailed` — Harmony patch เมธอดจบ/ยกเลิกออเดอร์ของเกม
  แล้ว map กลับเป็น eventId ที่เก็บไว้ตอน `TryCreateOrder`
- `GameStateChanged` — patch pause/resume และการเข้า/ออกเมนูหลัก
  **อย่าใช้ `Time.timeScale` เป็น timer** — ปล่อยให้ server ถือเวลา (สเปกข้อ 6)
- `GetRecipeCatalog` / `CatalogChanged` — ดึงสูตร Base Game จาก `FoodnetworkDish`
  (หรือ `RecipesProvider`) map `Recipe.Id` + `RecipeDifficulty` + makeable ส่งให้
  server ผ่าน `/catalog` (ขับ recipe pool จากเกม) — ดู VERIFY ใน internals doc
