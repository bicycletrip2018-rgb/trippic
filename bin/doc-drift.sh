#!/usr/bin/env bash
# =====================================================================
# 문서 표류 검사 — **문서가 코드와 어긋나면 머지를 막는다** (§13.184)
#
# ★ 왜 — CI 가 **DB 표류**(코드의 마이그레이션 ↔ 실서버)는 이미 잡는다.
#   그런데 **문서 표류**는 아무도 안 잡았다. 그래서 §0 이 *"사진은 Cloudflare R2"*
#   라고, §6 이 *"3탭"* 이라고 두 달 동안 적혀 있었고, 인수인계에서 사람이
#   **25개를 물어서** 알아냈다(§13.181~§13.183). 그 25개는 거의 전부
#   **명령 한 줄로 답이 나오는 것**이었다.
#   → 사람이 묻기 전에 **기계가 먼저 막는다.** 그게 이 파일의 전부다.
#
# ★ 재지 못하는 것은 **검사하지 않는다.** 「첫 출시를 iOS 로 할지」 같은 것은
#   사람의 결정이고, 그건 `DECISIONS.md` 가 맡는다. 여기서 억지로 재면
#   거짓 경보가 쌓이고, 거짓 경보가 쌓이면 **사람이 빨간 X 를 무시하기 시작한다.**
#
# 사용:  ./bin/doc-drift.sh          (네트워크·자격증명 필요 없음 · 2초)
# 나감:  0 = 어긋난 것 없음   ·   1 = 어긋났다(무엇이 어떻게인지 찍는다)
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/probe.sh"

FAIL=0
red(){ printf "\033[31m%s\033[0m\n" "$*"; }
green(){ printf "\033[32m%s\033[0m\n" "$*"; }
bad(){ FAIL=1; red "  ✗ $1"; [ $# -gt 1 ] && printf "      → %s\n" "$2"; }
ok(){ printf "  ✓ %s\n" "$1"; }

echo "── 문서 표류 검사 ──────────────────────────────────────────"

# ─────────────────────────────────────────────────────────────────────
# 1. 기능 표(bin/features.tsv)의 «기대» 가 코드와 같은가
# ─────────────────────────────────────────────────────────────────────
echo "① 기능 표 ↔ 코드"
N=0; M=0
while IFS=$'\t' read -r key name want scope re; do
  [ -z "${key:-}" ] && continue
  case "$key" in \#*) continue ;; esac
  N=$((N+1))
  got="$(probe_one "$re" "$scope")"
  if [ "$got" != "$want" ]; then
    M=$((M+1))
    bad "$key ($name): 표는 «$want» 인데 코드는 «$got»" \
        "코드가 바뀐 것이면 bin/features.tsv 의 기대를 «$got» 으로 고치고, PLAN.md §13.183 A-1 과 CHECKLIST.md 도 같이 고쳐라. 패턴이 주석에 걸린 것이면 패턴을 좁혀라(features.tsv 머리글의 ★★ 참고): grep -rnE '$re' rn-bench/src"
  fi
done < "$ROOT/bin/features.tsv"
[ "$M" = 0 ] && ok "$N 줄 전부 일치"

# ─────────────────────────────────────────────────────────────────────
# 2. 문서에 **손으로 적은 숫자**가 실제와 같은가
#    ★ `# 99 (…)` 처럼 주석으로 적어 둔 기대값을 찾아 실제와 맞춘다.
#      START_HERE.md 의 «확인하는 세 줄» 이 틀린 숫자를 말하면, 새 사람이
#      **자기가 뭘 잘못했다고 생각한다.** 그게 제일 나쁘다.
# ─────────────────────────────────────────────────────────────────────
echo "② 문서에 적힌 숫자"
MIG="$(count_migrations)"
HITS=0
while IFS=: read -r f n line; do
  [ -z "${f:-}" ] && continue
  HITS=$((HITS+1))
  claimed="$(printf '%s' "$line" | grep -oE '#[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1)"
  if [ "$claimed" != "$MIG" ]; then
    bad "$(basename "$f"):$n — 마이그레이션 개수를 «$claimed» 라고 적었는데 실제는 «$MIG»" \
        "그 줄의 숫자를 $MIG 로 고쳐라"
  fi
done < <(grep -rnE 'migrations/\*\.sql[^#]*#[[:space:]]*[0-9]+' \
           --include='*.md' --include='*.sh' "$ROOT" 2>/dev/null \
         | grep -v '/node_modules/' || true)
[ "$HITS" = 0 ] && echo "  · 숫자를 적어 둔 줄을 못 찾았다 (검사 건너뜀)" || { [ "$FAIL" = 0 ] && ok "$HITS 줄 확인"; }

# ─────────────────────────────────────────────────────────────────────
# 3. 썩은 절에 **배너가 붙어 있는가**
#    ★ §0·§5·§6·§12 는 기획 당시의 기록이라 **고치지 않는다**(§13.183 B-5).
#      대신 머리에 «지금 사실은 어디» 를 적어 뒀다. 누가 그 배너를 지우면
#      문서가 조용히 다시 거짓말을 시작한다 → 지우면 여기서 막는다.
# ─────────────────────────────────────────────────────────────────────
echo "③ 썩은 절의 배너"
BANNER='STATUS.md'
# ★ `^## 12\.` 는 **두 군데** 걸린다(기술 스택 · 탭 구조 재설계). `head -1` 이
#   앞의 것(기술 스택)을 잡는다 — 거기가 R2 를 적어 둔 절이라 맞다.
for sec in '^## 0\. 확정 사항' '^## 5\. 범위' '^## 6\. 화면 구조' '^## 12\. 기술 스택'; do
  ln="$(grep -nE "$sec" "$ROOT/PLAN.md" | head -1 | cut -d: -f1)"
  if [ -z "$ln" ]; then
    echo "  · $sec — 절을 못 찾았다 (제목이 바뀐 듯. 이 검사를 고쳐라)"
    continue
  fi
  if sed -n "${ln},$((ln+6))p" "$ROOT/PLAN.md" | grep -q "$BANNER"; then
    ok "$(sed -n "${ln}p" "$ROOT/PLAN.md" | sed 's/^## //') — 배너 있음"
  else
    bad "PLAN.md:$ln 의 절에 **배너가 없다**" \
        "그 절 바로 아래에 «지금 사실은 STATUS.md / §13.183» 한 줄을 넣어라"
  fi
done

# ─────────────────────────────────────────────────────────────────────
# 4. 환경변수 이름이 **네 곳에서 같은가**
#    ★ `config.ts` 가 읽는 이름 · `.env.example` · CHECKLIST 의 eas env:create ·
#      `.env.local`(있으면). 하나만 어긋나면 **깨끗한 체크아웃에서 빌드가 멎는다**
#      (§13.134 에서 실제로 멎었다).
# ─────────────────────────────────────────────────────────────────────
echo "④ 환경변수 이름"
WANT="$(grep -ohE 'EXPO_PUBLIC_[A-Z_]+' "$ROOT/rn-bench/src/config.ts" | sort -u)"
for f in "$ROOT/rn-bench/.env.example" "$ROOT/CHECKLIST.md"; do
  [ -f "$f" ] || { echo "  · $(basename "$f") 없음 (건너뜀)"; continue; }
  miss=""
  for v in $WANT; do grep -q "$v" "$f" || miss="$miss $v"; done
  if [ -n "$miss" ]; then bad "$(basename "$f") 에 없는 이름:$miss" "config.ts 가 읽는 이름과 맞춰라"
  else ok "$(basename "$f") — $(echo "$WANT"|wc -l|tr -d ' ')개 전부 있음"; fi
done

# ─────────────────────────────────────────────────────────────────────
# 5. STORE.md 의 세 주소가 **초대 주소와 같은 폴더인가**
#    ★ 앱은 `INVITE_BASE` 하나에서 terms/privacy/support 를 **만든다**
#      (`siteLinks.ts` 의 `sitePage()`). 그런데 스토어에 내는 주소는 STORE.md 에
#      **손으로** 적혀 있다. 둘이 어긋나면 **심사에 낸 주소만 404 가 된다** —
#      그리고 404 는 눌러 본 사람만 안다(§13.136).
# ─────────────────────────────────────────────────────────────────────
echo "⑤ 스토어에 적은 주소"
if [ -f "$ROOT/rn-bench/.env.local" ]; then
  BASE="$(grep -m1 '^EXPO_PUBLIC_INVITE_BASE=' "$ROOT/rn-bench/.env.local" | cut -d= -f2- | sed 's#/[^/]*$##')"
  if [ -z "$BASE" ]; then echo "  · .env.local 에 INVITE_BASE 가 없다 (건너뜀)"
  else
    for pg in terms privacy support; do
      if grep -q "$BASE/$pg.html" "$ROOT/STORE.md"; then ok "$pg.html"
      else bad "STORE.md 의 $pg 주소가 초대 주소와 다른 폴더다" "있어야 하는 것: $BASE/$pg.html"; fi
    done
  fi
else
  echo "  · rn-bench/.env.local 이 없다 (CI 는 비밀값이 없다 — 건너뜀)"
fi

# ─────────────────────────────────────────────────────────────────────
# 6. 탭 목록이 **코드에서 뽑히는가**
#    ★ 숫자 자체는 검사하지 않는다 — `STATUS.md` 가 코드에서 뽑아 쓴다.
#      여기서 보는 것은 **뽑는 길이 살아 있는가** 다. `TabBar.tsx` 의 모양이
#      바뀌면 `tabs_list` 가 **조용히 0 개**를 돌려주고, STATUS.md 가
#      «탭 0개» 라고 적는다. 0 은 틀린 게 아니라 **못 잰 것**이다.
# ─────────────────────────────────────────────────────────────────────
echo "⑥ 탭 뽑는 길"
TC="$(tabs_count)"
if [ "${TC:-0}" -ge 2 ]; then ok "$TC 개 뽑힘 — $(tabs_list | sed -E 's/^[a-z]+://' | tr '\n' '~' | sed 's/~$//; s/~/ · /g')"
else bad "TabBar.tsx 에서 탭을 못 뽑았다 ($TC 개)" "bin/probe.sh 의 tabs_list 정규식을 TabBar.tsx 의 지금 모양에 맞춰라"; fi

echo "──────────────────────────────────────────────────────────"
if [ "$FAIL" = 0 ]; then green "문서 표류 없음"; exit 0; fi
red "문서가 코드와 어긋난다 — 위의 → 를 따라 고쳐라"
echo "(이 검사가 과했다면 그 검사를 고치는 것도 답이다. 다만 **왜 과한지**를"
echo " bin/doc-drift.sh 주석에 적어라 — 거짓 경보가 쌓이면 사람이 빨간 X 를 무시한다.)"
exit 1
