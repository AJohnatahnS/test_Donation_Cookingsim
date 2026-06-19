# Cooking Simulator — แผนที่ภายในสำหรับต่อ Mod

อ่านตรงจาก `Assembly-CSharp.dll` (เวอร์ชันที่ติดตั้งที่ `D:\Game\steamapps\common\CookingSimulator`)
เป็นชื่อคลาส/เมธอด/enum จริงสำหรับเติม [../mod/src/CookingSimGameBridge.cs](../mod/src/CookingSimGameBridge.cs)

> ✅ **2026-06-19: build + โหลดในเกมสำเร็จแล้ว** — mod คอมไพล์กับ DLL จริง (0 warning/error)
> และโหลดผ่าน BepInEx 5.4.23.5 ในเกมจริง (Unity 2022.3) ด้วย `UseSimulatedBridge=false`
> โดย `Harmony.PatchAll()` ผูก patch ครบทุกจุดโดยไม่มี exception (ดูหัวข้อ "ผลการ verify" ท้ายไฟล์)
> เหลือเฉพาะการยืนยัน **พฤติกรรมตอนเล่นจริง** (ต้องเข้าโหมด Food Network จริง) — มาร์ค `ตรวจในเกม`

## สภาพแวดล้อม

- Unity **2022.3** Mono (มี `MonoBleedingEdge/`, `UnityPlayer.dll` = 2022.3.62) → **BepInEx 5 x64 (Mono)**
  - Unity 2022 → ใช้ `UnityWebRequest.result == Result.Success` (csproj define `UNITY_2020_1_OR_NEWER`)
- `JsonUtility` อยู่ใน **`UnityEngine.JSONSerializeModule.dll`** (ต้องอ้างอิงแยกจาก CoreModule)
- มี `UnityEngine.UnityWebRequestModule.dll` และ `Newtonsoft.Json.dll` ใน `Managed/`
- โหมดเกมหลักที่สเปกใช้ = **Base Career / Food Network** (`GameState.FoodNetwork` / `Career`)

## คลาสหลักที่ใช้

### `GameManager` — สถานะเกมสำหรับ endpoint `/game`
- `GameState GameState` (instance), `bool IsMenu` / `bool IsPlaying` / `bool IsSandboxMode` (instance)
- **`bool Paused` และ `bool DuringGame` เป็น `static`** ← จุดสำคัญ
- ⚠️ **ไม่มี event `GameStateChanged` และไม่มี singleton accessor** (เช่น `.Me`/`.Instance`)
  ที่คืน `GameManager` → แผนเดิมที่จะ subscribe event/อ่าน `__instance.IsMenu` **ใช้ไม่ได้**
  - ทางแก้ที่ใช้จริง: Harmony patch setter `set_Paused` (static) + `set_GameState` (instance)
    แล้ว**สรุปสถานะจาก static ล้วน**: `paused = GameManager.Paused`, `isMenu = !GameManager.DuringGame`
    (เลี่ยงปัญหาว่า `IsMenu` เป็น instance แต่ไม่มีตัวชี้ instance ในบริบท patch แบบ static)
  - `ตรวจในเกม`: `DuringGame` ต้องเป็น false ตรงกับจอเมนู/นอกเกมเพลย์ (จออาจ false ตอนโหลดด้วย)

### `FoodNetworkManager` (singleton: `FoodNetworkManager.Me`) — ระบบออเดอร์ Base career
- `Recipe currentRecipe` — สูตรของออเดอร์ปัจจุบัน (**ทีละ 1 ออเดอร์**)
- `List<Recipe> recipes`, `ReadOnlyCollection<Recipe> FoodnetworkDish`
- `IEnumerator OrderLoop()` — คอร์รูทีนที่ปล่อยออเดอร์
- **`void SetDebugRecipesOrder(bool, Recipe)`** + `Recipe nextDebugRecipe` +
  `bool TryGetNextDebugRecipe(Recipe)` + `bool DebugRecipesOrder`
  → **ช่องบังคับสูตรของออเดอร์ถัดไป** (ใช้สร้างออเดอร์ตามที่ผู้ชมเลือก)
- **`void OrderEnd(Recipe recipe)` และ `void OrderCancel(Recipe recipe)` เป็น `private`** →
  Harmony patch ต้องอ้างด้วย **string** `"OrderEnd"`/`"OrderCancel"` (ใช้ `nameof` ไม่ได้ เพราะ private)
  พารามิเตอร์ inject ด้วยชื่อจริง `recipe` → Postfix ยิง `OrderCompleted`/`OrderFailed`
- `void OrderCancelEmptyPlate()` — ยกเลิกอีกทาง (ยังไม่ patch)
- `Action OnTimeEnd`, `float ChallangeTimeLimit`, `float GameTime`, `RestartMealTimer()`

### `Recipe`
- **`ID CoreId`** (struct ห่อ `int id`, มี `.Id` คืน int) ← **ใช้ตัวนี้** `recipe.CoreId.Id`
  - `int Id` **ถูก deprecate** ("Use CoreId instead") — เลี่ยง, ใช้ `CoreId.Id` (int เดียวกัน parse ได้)
- **`bool BaseGameRecipe`** — กรอง "เฉพาะ Base Game" (สเปก §1/§8)
- **`RecipeDifficulty RecipeDifficulty`** — field, enum อยู่ใน **namespace `Recipes`** (`Recipes.RecipeDifficulty`)
  ค่า `Easy / Medium / Hard` (ต้อง `using Recipes;`)
- ⚠️ **ไม่มี field ชื่อสูตรแบบ plain** (`RecipeName` ไม่มีจริง — ชื่อเป็น localized key)
  → catalog ส่ง `name = "#<id>"` ไปก่อน; ชื่อ localized สวยๆ เป็น TODO ด้านความสวยงามอย่างเดียว
- `RecipePackage RecipePackageType` — enum `Classic, American, Chinese, FoodNetwork, BBQ, ...`
  (ตัด DLC ด้วยการรับเฉพาะ `Classic` / `FoodNetwork`)

### `RecipesProvider` (เข้าถึงผ่าน service locator — `ServicesManager`? `ตรวจในเกม`)
- `IReadOnlyList<Recipe> Recipes`
- `IReadOnlyList<ID> UnlockedRecipes`, `UnlockedMainRecipes`, `UnlockedSideRecipes`
- `Recipe GetRecipeTemplate(ID)` — หาสูตรจาก ID
- `bool IsRecipeUnlocked(ID)`
- `void UnlockRecipe(ID, bool)` — ปลดล็อก (พารามิเตอร์ bool = save ถาวรหรือไม่ — **`ตรวจในเกม`
  ต้องปลดล็อกแบบ runtime ไม่เขียนเซฟถาวร** ตามสเปก §1)

## แมปเข้ากับโปรโตคอล

| โปรโตคอล | เกมจริง |
|---|---|
| difficulty `easy/normal/hard` | `Recipes.RecipeDifficulty.Easy/Medium/Hard` |
| "เฉพาะ Base Game" | `Recipe.BaseGameRecipe == true` |
| recipe id | **`Recipe.CoreId.Id`** (int) — *ไม่ใช่* `Recipe.Id` (deprecated) |
| สร้างออเดอร์ | `FoodNetworkManager.Me.SetDebugRecipesOrder(true, recipe)` |
| ออเดอร์สำเร็จ/ยกเลิก | Postfix private `OrderEnd` / `OrderCancel` (อ้างด้วย string) |
| สถานะเกม | patch `set_Paused`(static)/`set_GameState` → `GameManager.Paused` + `!GameManager.DuringGame` |

## ความไม่ตรงกันกับเกมจริง

1. ✅ **แก้แล้ว — เกม Base career เสิร์ฟทีละ 1 ออเดอร์** (`currentRecipe` เดี่ยว +
   `OrderLoop`) แต่โปรโตคอลออกแบบรองรับหลายออเดอร์
   → ตั้ง `config.queue.maxConcurrentOrders = 1` เป็น default แล้ว (1 ≤ เพดาน 3
   ของ §7 จึงยังผ่าน acceptance) ออเดอร์ที่เหลือรอในคิวตามปกติ

2. ✅ **แก้แล้ว — ที่มาของรายการสูตร** — Mod ส่ง catalog สูตรจริงของเกม
   (`FoodnetworkDish`/`RecipesProvider.Recipes` ที่ `BaseGameRecipe` + difficulty +
   makeable) ผ่าน `POST /catalog` ให้ server ขับ recipe pool แทน `recipes.json`
   placeholder เลิกใช้โมเดล "kitchen tokens" — `makeable` มาจากเกมตรงๆ และ
   `config.recipePool.difficultyOverrides` ให้ operator re-bucket ความยากตาม §8
   (Node + protocol + bridge อัปแล้ว เหลือยืนยันบรรทัด VERIFY ในเกม)

3. **โหมด Food Network มี loop/เวลาของตัวเอง** — ต้องยืนยันในเกมว่า `SetDebugRecipesOrder`
   บังคับออเดอร์ถัดไปได้ตามจังหวะที่เราต้องการจริง (`ตรวจในเกม`)

## ขั้นตอน build/test

1. ติดตั้ง BepInEx 5 x64 (Mono) ลงโฟลเดอร์เกม (ทำแล้ว: 5.4.23.5)
2. `dotnet build mod/CookingSimDonationMod.csproj -c Release` (csproj ตั้ง path เครื่องนี้ไว้แล้ว;
   override ด้วย `-p:GameDir="..."` ถ้าย้ายเครื่อง)
   - หมายเหตุ: เครื่องนี้มี machine-wide NuGet.Config ชี้ fallback folder ที่หายไป →
     `mod/nuget.config` ล้าง fallback/sources เพื่อ build offline ล้วน
3. คัดลอก DLL ไป `BepInEx/plugins/` ตั้ง `Game.UseSimulatedBridge=false`
4. เปิดเกมโหมด Food Network + รัน `node server.js` + ตัวป้อนโดเนต แล้วดู log/overlay

## ผลการ verify (2026-06-19)

✅ **คอมไพล์** กับ DLL จริง: `bin/Release/CookingSimDonationMod.dll` — 0 warning, 0 error
✅ **โหลดในเกมจริง** (Unity 2022.3, BepInEx 5.4.23.5) ด้วย `UseSimulatedBridge=false`:
`LogOutput.log` แสดง `Cooking Sim Donation Mod 0.1.0 loaded — ... Cooking Simulator bridge`
ตามด้วย `Chainloader startup complete` **ไม่มี exception ใดๆ**
→ พิสูจน์ว่า reference ครบ และ `Harmony.PatchAll()` **ผูก patch target ครบทั้ง 4 จุด**
(`OrderEnd`/`OrderCancel` private, `set_Paused` static, `set_GameState`) สำเร็จกับ runtime จริง

🟡 **ยังต้อง `ตรวจในเกม` (ต้องเข้าเล่น Food Network จริง)** — ส่วนที่ build/load ยืนยันไม่ได้:
1. `SetDebugRecipesOrder(true, recipe)` บังคับออเดอร์ถัดไปจริงตามจังหวะที่ต้องการ
2. `FoodnetworkDish` ถูก populate ตอนอยู่ในโหมด (catalog ไม่ว่าง)
3. `OrderEnd`/`OrderCancel` ยิงจริงตอนจบ/ยกเลิกออเดอร์ และ map กลับ eventId ถูก
4. `!DuringGame` ตรงกับสถานะ "เมนู" ที่เราต้องการรายงานจริง
