# Cooking Simulator — แผนที่ภายในสำหรับต่อ Mod

อ่านตรงจาก `Assembly-CSharp.dll` (เวอร์ชันที่ติดตั้งที่ `D:\Game\steamapps\common\CookingSimulator`)
เป็นชื่อคลาส/เมธอด/enum จริงสำหรับเติม [../mod/src/CookingSimGameBridge.cs](../mod/src/CookingSimGameBridge.cs)

> ทุกอย่างในนี้มาจาก metadata ของ DLL จริง แต่ **ยังไม่ได้ทดสอบในเกม** (sandbox นี้
> build mod / รันเกมไม่ได้) จุดที่ยังไม่ชัวร์มาร์ค `ตรวจในเกม` ไว้

## สภาพแวดล้อม

- Unity **Mono** (มี `MonoBleedingEdge/`) → ใช้ **BepInEx 5 x64 (Mono)**
- มี `UnityEngine.UnityWebRequestModule.dll` และ `Newtonsoft.Json.dll` ใน `Managed/`
- โหมดเกมหลักที่สเปกใช้ = **Base Career / Food Network** (`GameState.FoodNetwork` / `Career`)

## คลาสหลักที่ใช้

### `GameManager` (singleton — น่าจะ `Singleton<GameManager>.Instance`, `ตรวจในเกม`)
สถานะเกมสำหรับ endpoint `/game`:
- `GameState GameState` (enum: `Menu, Career, FoodNetwork, Sandbox, ...`)
- `bool Paused`, `bool IsPlaying`, `bool IsMenu`, `bool DuringGame`
- `string KitchenID`, `List<string> CurrentContentIDs` (ไว้ตรวจ DLC ที่เปิดอยู่)
- **event** `Action GameStateChanged` ← subscribe ตัวนี้เพื่อรายงาน playing/paused/menu
- `PauseTime()/UnpauseTime()`, `PauseTimeScale()/UnPauseTimeScale()` (เกมใช้ timeScale เอง —
  Mod แค่ "อ่าน" สถานะ ไม่ต้องไปยุ่ง ปล่อยเวลาให้ server ถือ ตามสเปก §6)

### `FoodNetworkManager` (singleton: `FoodNetworkManager.Me`) — ระบบออเดอร์ Base career
- `Recipe currentRecipe` — สูตรของออเดอร์ปัจจุบัน (**ทีละ 1 ออเดอร์**)
- `List<Recipe> recipes`, `ReadOnlyCollection<Recipe> FoodnetworkDish`
- `IEnumerator OrderLoop()` — คอร์รูทีนที่ปล่อยออเดอร์
- **`void SetDebugRecipesOrder(bool, Recipe)`** + `Recipe nextDebugRecipe` +
  `bool TryGetNextDebugRecipe(Recipe)` + `bool DebugRecipesOrder`
  → **ช่องบังคับสูตรของออเดอร์ถัดไป** (ใช้สร้างออเดอร์ตามที่ผู้ชมเลือก)
- `void OrderEnd(Recipe)` — ออเดอร์สำเร็จ → Harmony **Postfix** เพื่อยิง `OrderCompleted`
- `void OrderCancel(Recipe)`, `void OrderCancelEmptyPlate()` — ยกเลิก → `OrderFailed`
- `Action OnTimeEnd`, `float ChallangeTimeLimit`, `float GameTime`, `RestartMealTimer()`

### `Recipe`
- `int Id`, `ID CoreId` (struct `ID` ที่ provider ใช้), `int JsonID`, `int GeneratedID`
- **`bool BaseGameRecipe`** — กรอง "เฉพาะ Base Game" (สเปก §1/§8)
- **`RecipeDifficulty RecipeDifficulty`** — enum `Easy / Medium / Hard`
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
| difficulty `easy/normal/hard` | `RecipeDifficulty.Easy/Medium/Hard` |
| "เฉพาะ Base Game" | `Recipe.BaseGameRecipe == true` + `RecipePackageType ∈ {Classic, FoodNetwork}` |
| recipe id | `Recipe.Id` / `Recipe.CoreId` |
| สร้างออเดอร์ | `FoodNetworkManager.Me.SetDebugRecipesOrder(true, recipe)` |
| ออเดอร์สำเร็จ/หมดเวลา/ยกเลิก | Postfix `OrderEnd` / `OnTimeEnd` / `OrderCancel` |
| สถานะเกม | `GameManager.GameStateChanged` + `.Paused` / `.GameState` |

## ⚠️ ความไม่ตรงกันที่ต้องตัดสินใจ

1. **เกม Base career เสิร์ฟทีละ 1 ออเดอร์** (`currentRecipe` เดี่ยว + `OrderLoop`)
   แต่โปรโตคอลออกแบบรองรับ 3 ออเดอร์พร้อมกัน
   → **แนะนำตั้ง `config.queue.maxConcurrentOrders = 1`** สำหรับโหมดนี้ (server รองรับอยู่แล้ว)
   ออเดอร์ที่เหลือรอในคิวตามปกติ

2. **ที่มาของรายการสูตร** — ควรดึงสูตรจริงจากเกม (`RecipesProvider.Recipes` ที่
   `BaseGameRecipe` + difficulty) แล้วให้ Mod ส่ง catalog ไปให้ server แทน `recipes.json`
   ที่เขียนมือ และเลิกใช้โมเดล "kitchen tokens" หันไปใช้ `IsRecipeUnlocked` แทน
   → เป็นงานปรับทั้งสองฝั่ง (เพิ่ม endpoint รับ catalog) ตัดสินใจก่อนลงมือ

3. **โหมด Food Network มี loop/เวลาของตัวเอง** — ต้องยืนยันในเกมว่า `SetDebugRecipesOrder`
   บังคับออเดอร์ถัดไปได้ตามจังหวะที่เราต้องการจริง (`ตรวจในเกม`)

## ขั้นตอน build/test (ทำนอก sandbox นี้)

1. ติดตั้ง BepInEx 5 x64 (Mono) ลงโฟลเดอร์เกม รันเกม 1 ครั้งให้สร้าง `BepInEx/plugins`
2. `dotnet build mod/CookingSimDonationMod.csproj -c Release -p:GameManagedDir="...\CookingSim_Data\Managed"`
3. คัดลอก DLL ไป `BepInEx/plugins/` ตั้ง `Game.UseSimulatedBridge=false`
4. เปิดเกมโหมด Food Network + รัน `node server.js` + ตัวป้อนโดเนต แล้วดู log/overlay
