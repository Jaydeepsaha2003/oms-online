# Multi-transporter per party, with transporter-wise rates on Create Challan

## Problem

PNB ka maal kabhi BEST ROADWAYS se jata hai, kabhi BHOOMI TRANSPORT se. Rate dono
mein alag hain. Aaj system party pe sirf **ek** transporter rakhta hai, aur Create
Challan pe transporter ek **readOnly box** hai — badla hi nahi ja sakta.

## Jo pehle se bana hua hai (koi naya kaam nahi)

Research se nikla ki 70% infra already maujood hai:

- `trans_rates` table = customer x category x type(FREIGHT|PACKING) x **transporter** -> rate.
  Live: 581 rows, 144 parties. **4 parties ke paas abhi bhi 2-2 transporter hain.**
- Pricing already transporter-aware hai — `challans.service.ts:1160`:
  `matches.find(t => t.transportName === transName) ?? matches[0]`
- Freight/Packing already bags ke hisab se — `challans.service.ts:282`:
  `freight = SUM(bags x freightRate)`, `packing = SUM(bags x packingRate)`
- "Rate set hi nahi kiya" vs "rate 0 set kiya" ka farak code mein already hai
  (`rateFor` null lautata hai, 0 nahi) — `challans.service.ts:1155-1157`
- Unpriced-line warning UI already hai — `challan-form-page.tsx:123`

**Isliye koi schema change nahi, koi migration nahi.** Sirf wiring ka kaam hai.

## Decisions (user ne confirm kiye)

| Sawal | Faisla |
|---|---|
| Transporter list kahan se | `trans_rates` se derive — nayi table nahi. Bhoomi ke rate daalo, dropdown mein aa jayega. |
| Default transporter | `customer.transportName` — jaisa abhi hai. 139 parties ka data waisa ka waisa. |
| Box rate transporter-wise? | **Nahi.** Customer pe hi rahega. |
| Picked transporter ka rate missing | Strict — challan rukega, "Set rates" button se Transporter Rates khulega, wahan se "Back to Create Challan". |
| 10 legacy parties (default ka koi rate row nahi) | Inko bhi strict pe daalo. Pehli baar redirect aayega, user rate set karega, data apne aap theek. |

## Asli bug jo theek karna hai

`matches.find(...) ?? matches[0]` — agar chuna hua transporter ka row nahi mila toh
system **chup chaap kisi aur transporter ka rate** laga deta hai. Yahi woh cheez hai
jiska user ko dar tha.

Strict karne pe blast radius naapa gaya: **581 rows mein se 37 (10 parties)**
aise hain jinka default transporter kisi rate row se match nahi karta. Aaj `matches[0]`
unhe chupke se bacha raha hai. User ne kaha: inko bhi strict pe daalo.

## Kaam

### 1. API — strict transporter matching
`apps/api/src/challans/challans.service.ts`
- `rateMaps()` (L1149) aur bulk `rateFor` (L1141): jab `transName` diya ho, sirf usi
  transporter ka row lo. Na mile -> `null` (unpriced), `matches[0]` **nahi**.
  `transName` null ho toh purana behaviour (`matches[0]`) waisa hi.

### 2. API — challan draft picked transporter maane
- `DraftChallanDto` mein optional `transName` add (`dto/challan.dto.ts`)
- `draft()` L251: `customer?.transportName` ki jagah `dto.transName ?? customer?.transportName`
- `editContext()` L1128: customer ke bajaye **saved challan ka** `transName` use karo —
  warna purana challan kholne pe rate badal jayenge

### 3. API — party ke transporters ki list
`apps/api/src/trans-rates/trans-rates.service.ts` + controller
- `GET /trans-rates/transporters?customerName=X` -> distinct `transportName` from
  `trans_rates` + `customer.transportName`, default sabse pehle.
  Ek `findMany({ distinct: ['transportName'] })` — ek line ka kaam.

### 4. Web — Create Challan pe dropdown
`apps/web/src/features/challans/challan-form-page.tsx`
- L1485 ka readOnly `<Input>` -> `<NativeSelect>` (already hai `components/common/combo.tsx`)
- Badalne pe draft dobara fetch -> freight/packing/rates apne aap recompute (bags x rate)
- Edit mode mein bhi same dropdown

### 5. Web — missing rate pe redirect + wapas
- Maujooda unpriced warning (L123) ko transporter ka naam bolne do:
  "BHOOMI TRANSPORT ke CUP rates set nahi hain"
- Us warning mein **"Rates set karo"** button -> `/trans-rates` par customer +
  transporter preselect karke, aur `navigate` state mein return URL
- Transporter Rates page pe **"Back to Create Challan"** button jab return URL ho —
  wapas aate hi draft refetch, naye rate lag jayein

Files: `trans-rates-page.tsx`, `customer-trans-rates.tsx`

## Verify

Repo mein test framework nahi hai; convention `scripts/verify-*.cjs` / `test-*.cjs` hai.

1. `scripts/test-multi-transporter.cjs` — API pe:
   - PNB ka draft BEST ROADWAYS se -> freight/packing aaye
   - wahi draft BHOOMI se -> alag rate aaye
   - aise transporter se jiska row nahi -> `freightRate: null` (0 nahi, aur dusre
     transporter ka rate **nahi**)
   - rate 0 set wala transporter -> `0` aaye, `null` nahi (ye asli farak hai)
2. `npm run lint -w @oms/api` aur `-w @oms/web`
3. Browser: PNB ka challan banao, transporter badlo, dekho packing/freight bags ke
   hisab se badle; ek bina-rate transporter chuno, "Rates set karo" dabao, rate daalo,
   "Back to Create Challan" se wapas aake naye rate lage hue dikhein
4. 10 legacy parties mein se ek (K K TRADING) kholo — redirect flow saaf chale

## Scope se bahar

Box rate transporter-wise - nayi party_transporters table - Transporter screen ke
packing/freight fields (K-4.3 mein hide ho chuke) - purane challans ka re-pricing
