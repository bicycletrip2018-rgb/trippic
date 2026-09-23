# RN 이식 검증 결과

검증일: 2026-09-18
대상: `PLAN.md` §13 미정 — *"RN(GL Native) 이식 검증 — `canvas` 소스 타입이 네이티브에 없다"*

## 결론 — **이식 가능하다.** 다만 세 군데를 바꿔야 한다

| | 웹 프로토타입 | RN |
|---|---|---|
| 아틀라스 소스 | `{type:'canvas'}` | **`<ImageSource url="file://…">`** ★ canvas 소스 없음 |
| 오프스크린 합성 | `<canvas>` 2D | **Skia 오프스크린 서피스** |
| 아이콘 등록 | `map.addImage(id, ImageData)` | **`<Images images={{id:"data:image/png;base64,…"}}>`** |
| 레이어 정의 | `map.addLayer({type,layout,paint})` | `<Layer type layout paint>` — **거의 그대로** |

---

## 무엇을 어떻게 검증했나

**할 수 있었던 것**
- npm 레지스트리에서 실제 패키지·버전 확인
- 패키지 tarball을 받아 **TypeScript 소스와 네이티브 구현(Objective-C / Kotlin)을 직접 읽음**
- 이식 코드를 작성하고 **`tsc --noEmit` 타입 검사 통과 (오류 0)**

**할 수 없었던 것**
- **네이티브 빌드와 실기기 실행.** 따라서 **성능은 전혀 측정하지 못했다.**
- 아래 "미검증" 절이 남은 위험의 전부다.

---

## 1. 버전 — momdeal이 이미 요구사항을 충족한다

| 패키지 | 최신 | 비고 |
|---|---|---|
| `@maplibre/maplibre-react-native` | **11.3.10** (2026-09-07) | 활발히 유지 중 |
| `@shopify/react-native-skia` | **2.12.0** (2026-09-16) | |

MapLibre RN 11.3.10의 peerDependencies:
```
expo >= 54.0.0 · react >= 19.1.0 · react-native >= 0.80.0
```
momdeal 현재: **expo ~54.0.32 · react 19.1.0 · react-native 0.81.5** → **그대로 충족.**
업그레이드 없이 붙일 수 있다. Expo config plugin(`app.plugin.js` → `withMapLibre`)도 제공한다.

> 단, 네이티브 모듈이므로 **Expo Go로는 안 된다.** dev client 빌드가 필요하다.

---

## 2. ★ 가장 중요한 발견 — `Images`와 `ImageSource`는 로딩 경로가 다르다

같은 라이브러리인데 **이미지를 가져오는 코드가 완전히 다르다.** 이걸 모르면 Android에서 조용히 실패한다.

### `ImageSource` (아틀라스) — **data: URI 안 된다**

```kotlin
// MLRNImageSource.kt
try {
    val uri = Uri.parse(url)
    if (uri.scheme == null) { /* 리소스 이름 */ }
    else { mURL = URL(url); source?.setUri(mURL!!.toURI()) }   // ← java.net.URL
} catch (e: Exception) {
    Log.w(LOG_TAG, e.localizedMessage ?: "Error setting URL")  // ← 예외를 삼킨다
}
```
`java.net.URL`은 `data:` 스킴을 지원하지 않아 `MalformedURLException`이 나는데,
**catch가 로그만 찍고 삼킨다.** 지도에 아무것도 안 뜨고 에러도 안 난다.

iOS도 `[NSURL URLWithString:]` → `MLNImageSource.URL`이라 사정이 비슷하다.

**→ 아틀라스는 반드시 `file://` 절대경로로 넘긴다.**

### `Images` (핀 아이콘) — **data: URI 된다**

```kotlin
// MLRNImages.kt
/**
 * ImageEntry.uri can be:
 * - A native asset name (simple name like "pin")
 * - A URL (starts with http/https/file/asset/data or /)   ← data 포함
 */
```
Android는 **Fresco**(`DownloadMapImageTask`), iOS는 **RCTImageLoader**를 쓴다. 둘 다 `data:`를 지원한다.

**→ 아이콘은 base64 data URI로 바로 넣을 수 있다. 파일로 쓸 필요가 없다.**

---

## 3. 아이콘 786개를 미리 만들 필요가 없다

```tsx
<Images
  images={icons}
  onImageMissing={(e) => addIcon(e.nativeEvent.image)}   // 레이어가 참조할 때 호출된다
/>
```
`onImageMissing`으로 **필요할 때만** 생성한다. 웹에서 786개를 부팅 시 전부 만들던 것(19.2MB)을
지연 생성으로 바꿀 수 있다. 아이콘 이름 규약(`ph{index}_{category}`)을 그대로 쓰면
이름만 파싱해서 만들어 넣으면 된다.

---

## 4. Skia에 필요한 API가 전부 있다 (타입 정의로 확인)

| 웹 canvas | Skia | 확인 |
|---|---|---|
| `document.createElement('canvas')` | `Skia.Surface.MakeOffscreen(w,h)` | ✅ |
| `ctx.clip('evenodd')` | `path.setFillType(FillType.EvenOdd)` + `canvas.clipPath(p, ClipOp.Intersect, true)` | ✅ |
| 연속 `clip()`이 교집합 | `ClipOp.Intersect` 반복 | ✅ |
| `ctx.drawImage(img, …)` | `canvas.drawImageRect(img, src, dest, paint)` | ✅ |
| `canvas.toDataURL()` | `image.encodeToBase64(ImageFormat.PNG)` / `encodeToBytes()` | ✅ |
| `new Image(); img.src=…` | `Skia.Data.fromURI/fromBase64/fromBytes` + `Skia.Image.MakeImageFromEncoded` | ✅ |

**보로노이 분할(10차에서 기각한 실험)도 같은 API로 그대로 옮겨진다** — 나중에 되살리더라도 문제없다.

---

## 5. 레이어 정의는 거의 그대로 옮겨진다

v11은 **MapLibre 스타일 스펙을 그대로** 쓴다. `type` / `layout` / `paint`,
`"icon-allow-overlap"` 같은 케밥 케이스 키, 표현식 배열까지 웹과 동일하다.

```tsx
<Layer id="poi-pin" type="symbol"
  filter={["all", ["!", ["has","point_count"]], ["<", ["get","rk"], 9999]]}
  layout={{ "icon-image": ["concat", ["get","img"], "_", ["get","c"]], … }}
  paint={{ "icon-opacity": PIN_OPACITY, … }} />
```

### 타입 검사에서 실제로 걸린 것들 (v10 기억으로 쓰면 전부 틀린다)

| 틀린 것 | 맞는 것 |
|---|---|
| `MapView` | **`Map`** |
| `MapViewRef` | **`MapRef`** |
| `ShapeSource` + `shape={}` | **`GeoJSONSource` + `data={}`** |
| `FillLayer` / `LineLayer` / `SymbolLayer` / `RasterLayer` | **`Layer type="fill"…`** (단일 컴포넌트) |
| `Camera defaultSettings={{centerCoordinate, zoomLevel}}` | **`initialViewState={{center, zoom}}`** |
| `getVisibleBounds()` → `[[e,n],[w,s]]` | **`getBounds()` → `[w,s,e,n]`** |
| `clusterProperties: {top: ["max", expr]}` | **`{top: [["max",["accumulated"],["get","top"]], expr]}`** (2요소 정식형) |
| 표현식 배열 리터럴 | **`as ExpressionSpecification` 필요** — 스펙 타입이 튜플이라 배열이 그대로 안 들어간다 |

마지막 항목은 웹(JS)에는 없던 단계다. 표현식마다 캐스팅이 붙어 코드가 조금 지저분해진다.

---

## 6. 미검증 — 남은 위험은 전부 여기 있다

**성능을 하나도 측정하지 못했다.** 웹에서 잰 수치(프레임 3.4ms, 아틀라스 59.8MB)는
Chromium/Mac 기준이고 **GL Native/중급 안드로이드로 이전되지 않는다.**

실기기에서 반드시 확인할 것:

1. **`MakeOffscreen(2048~4096)` 이 저사양 안드로이드에서 성공하는가.**
   실패 시 `null`을 반환하므로 폴백 경로가 필요하다 (코드에 자리를 뒀다).
   웹은 4096×3825를 썼지만 **모바일은 2048부터 시작**하도록 기본값을 낮춰 뒀다.
2. **아틀라스 재합성 시간.** 웹은 357ms였다. Skia는 GPU라 더 빠를 수도, 첫 호출 셰이더
   컴파일로 더 느릴 수도 있다.
3. **`ImageSource` URL 캐싱.** 같은 경로에 새 내용을 쓰면 갱신이 안 될 수 있다.
   → 코드에서 **매번 다른 파일명**을 쓰도록 했다. 오래된 파일 정리 로직이 필요하다.
4. **아이콘 지연 생성의 프레임 끊김.** `onImageMissing` 폭주 시 배칭이 필요할 수 있다.
5. **텍스처 예산.** 아틀라스 + 아이콘 합계가 저사양 기기에서 감당되는지.

---

## 7. 착수 순서 (권장)

```
1. Expo dev client 빌드에 maplibre-react-native + react-native-skia 추가
2. 빈 지도 + 행정경계 GeoJSON 만 띄운다        ← 여기서 대부분의 빌드 문제가 드러난다
3. Skia 오프스크린 → PNG 파일 → ImageSource 한 장                ★ 1번 위험 검증
4. 아이콘 지연 생성 + 클러스터                                    ★ 4번 위험 검증
5. 실기기(중급 안드로이드)에서 프레임·메모리 측정                  ★ 2·5번 위험 검증
```

3단계까지 가면 이 설계의 성패가 판가름 난다. **그 전에는 다른 기능을 붙이지 말 것.**

## 파일

| 파일 | 내용 |
|---|---|
| `src/atlas.ts` | Skia 오프스크린 합성 → PNG 파일. 웹 `buildAtlas()` 이식 |
| `src/pinIcons.ts` | 원형 썸네일 + 카테고리 테두리 → base64. 웹 `circleIcon()` 이식 |
| `src/TrippicMap.tsx` | 지도 컴포넌트. 웹 레이어 구성 전체 이식 |

```bash
cd rn-port && npm install && npm run typecheck   # 오류 0
```

---

# 2차 — 실제 네이티브 실행 측정 (2026-09-18)

## 환경

**iPhone 17 Pro 시뮬레이터 (iOS 26.5) · Release 빌드**
Expo 57 · RN 0.86.3 · MapLibre RN 11.3.10 · Skia 2.6.2 · Xcode 26.6

> ⚠️ **시뮬레이터는 Mac의 GPU·메모리를 쓴다.** 절대 수치는 중급 안드로이드로 이전되지 않는다.
> 이전되는 것은 **"되는가/안 되는가"** 와 **"어디가 병목인가"** 다.
> 실기기는 접근 권한이 없어 측정하지 못했다.

## ★ 핵심 — 설계가 네이티브에서 성립한다

| 검증 항목 | 결과 |
|---|---|
| `Skia.Surface.MakeOffscreen(1024/2048/4096)` | **전부 성공** (0~5ms) |
| Skia 오프스크린 → 파일 → `ImageSource` 렌더 | **성공** (화면 확인) |
| MapLibre가 **WEBP**를 디코드하는가 | **한다** |
| 행정경계 250개 GeoJSON 로드 | 132ms |
| 사진 디코드 (Skia) | 5ms/장 |

## 인코딩 포맷 비교 (2048 아틀라스, 90개 지역, 워밍업 후)

| 포맷 | 그리기 | 인코딩 | 기록 | 합계 | 크기 | 알파 |
|---|---:|---:|---:|---:|---:|:---:|
| PNG q100 | 44ms | 119ms | 32ms | 195ms | 0.28MB | O |
| PNG q0 | 5ms | 107ms | 30ms | 142ms | 0.28MB | O |
| **WEBP q80** | 5ms | 166ms | 7ms | **178ms** | **0.06MB** | **O** |
| WEBP q100 | 4ms | 88ms | 127ms | 219ms | 1.16MB | O |
| JPEG q85 | 52ms | 32ms | 9ms | 93ms | 0.08MB | **X** |

### 결정: **WEBP q80**
- PNG 대비 **파일 4.7배 작다** (0.06 vs 0.28MB). 4096이면 1.0MB → 약 0.2MB
- 알파를 유지한다 — 아틀라스는 지역 밖이 투명해야 하므로 JPEG를 쓸 수 없다
- 총 시간은 PNG와 사실상 같다

### PNG의 `quality`는 무의미하다
q100 → q0 로 낮춰도 **107 vs 119ms, 크기는 동일**. Skia의 PNG 인코더가 quality를 사실상 무시한다.

## ★ 워밍업이 가장 값싼 최적화다

```
MakeOffscreen(2048) 1회차   5ms
MakeOffscreen(2048) 2회차   1ms      ← 첫 호출에만 비용
아틀라스 그리기  192ms → 4~5ms        ← 워밍업 후 97% 감소
```
셰이더 컴파일이 첫 호출에 몰린다.
**앱 시작 시 더미 `MakeOffscreen`을 한 번 호출하면 첫 아틀라스가 ~190ms 빨라진다.**

> 1차 보고에서 "PNG 인코딩 442~736ms가 병목"이라고 적었던 것은 **틀렸다.**
> 워밍업이 안 된 첫 호출 비용이었다. 워밍업 후에는 88~166ms다.

## 아이콘 생성

| 포맷 | 개당 | 786개 환산 |
|---|---:|---:|
| PNG | 4.0ms | 3.1초 |
| **WEBP q80** | **2.6ms** | **2.0초** |

`onImageMissing` 지연 생성이므로 한 번에 2초가 아니라 **화면당 20개 ≈ 52ms**다.

## 빌드에서 걸린 것 — 타입 검사로는 잡히지 않는 것들

| 문제 | 원인 · 해결 |
|---|---|
| `Error: react-native-reanimated is not installed!` | **Skia 2.x의 런타임 의존성.** `react-native-reanimated` + `react-native-worklets` 설치 |
| MapLibre 바이너리 "다운로드 실패" | 실제론 SPM 아티팩트 캐시에 **0B 껍데기**가 남아 막은 것. 에러 문구가 네트워크 문제처럼 보인다. `build/SourcePackages` 삭제 후 `-clonedSourcePackagesDirPath` 지정 |
| `pod install` 크래시 | `LANG`이 UTF-8이 아님 → `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` |

MapLibre iOS는 CocoaPods가 아니라 **SPM 바이너리 타깃**으로 들어온다는 점도 기억할 것.

## 확정 권장안

```
아틀라스   WEBP q80  ·  2048부터 시작 (4096은 실기기 확인 후)
아이콘     WEBP q80  ·  onImageMissing 지연 생성
앱 시작    더미 MakeOffscreen 1회 워밍업        ← 190ms 절약
파일명     매번 다르게 (ImageSource URL 캐싱 회피)
```

## 여전히 미검증

- **중급 안드로이드 실기기** — GPU·메모리 예산, `MakeOffscreen(4096)` 성공 여부
- **프레임레이트** — 시뮬레이터에서는 Mac GPU라 의미 없음
- **Android의 `ImageSource` file:// 경로** — 코드로만 확인했고 실행은 못 했다
- 텍스처 총량(아틀라스 + 아이콘)이 저사양 기기에서 감당되는지

## 재현

```bash
cd rn-bench && npm install
npx expo prebuild -p ios
cd ios && LANG=en_US.UTF-8 pod install
xcodebuild -workspace rnbench.xcworkspace -scheme rnbench -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO -clonedSourcePackagesDirPath build/SPM build
xcrun simctl install booted build/Build/Products/Release-iphonesimulator/rnbench.app
xcrun simctl launch booted app.trippic.bench
```
데이터는 `prototype/`을 `localhost:5173`으로 서빙해야 한다.
