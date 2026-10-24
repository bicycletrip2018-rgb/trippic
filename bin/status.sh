#!/usr/bin/env bash
# =====================================================================
# 지금 상태를 **재서** STATUS.md 를 만든다 (§13.184)
#
# ★ 왜 — 인수인계에서 새 세션이 **3라운드에 25개**를 물었다(§13.181~§13.183).
#   그 25개의 거의 전부가 **명령 한 줄로 답이 나오는 것**이었다. 그런데 나는
#   손으로 재서 **산문으로** 옮겼다. 산문은 측정의 사본이고, 사본은 썩는다 —
#   §13.183 의 A-1 표 35줄은 화면 하나만 붙여도 틀려진다.
#   → **질문에 답하는 대신 질문이 필요 없게 만든다.** 이 스크립트가 그것이다.
#
# ★ 못 잰 것은 «재지 못함 + 어디를 열면 보이나» 로 적는다.
#   비워 두거나 «없음» 으로 적으면 **못 잰 것이 사실로 둔갑한다**(§13.183 E 의 교훈).
#
# 사용:
#   ./bin/status.sh              # 전부 (네트워크·자격증명 쓰는 것까지)
#   ./bin/status.sh --offline    # 코드·git 만 (5초, CI·비행기 안)
#   ./bin/status.sh --out -      # 파일 대신 화면으로
# =====================================================================
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=/dev/null
source "$HERE/probe.sh"

OFFLINE=0; OUT="$ROOT/STATUS.md"
while [ $# -gt 0 ]; do
  case "$1" in
    --offline) OFFLINE=1 ;;
    --out) shift; OUT="${1:-$OUT}" ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "모르는 옵션: $1" >&2; exit 64 ;;
  esac; shift
done

W=$(mktemp); trap 'rm -f "$W"' EXIT
say() { printf '%s\n' "$*" >> "$W"; }
NOTE=()                                  # 「재지 못함」 모음 — 맨 끝에 한 번에 적는다
skip() { NOTE+=("$1"); }

# ── 머리 ─────────────────────────────────────────────────────────────
say "<!-- 이 파일은 \`bin/status.sh\` 가 만든다. 손으로 고치지 마라 — 다음 실행에 덮인다."
say "     돌리면 생성 시각·브랜치 때문에 **늘 바뀐 것으로 뜬다.** 그건 정상이다 —"
say "     내용이 달라진 게 없으면 \`git checkout -- STATUS.md\` 로 버리고,"
say "     실제로 달라졌으면(기능이 늘었다거나) **그때만** 커밋한다. -->"
say "# 지금 상태 — **재서 쓴 것**"
say ""
say "\`\`\`"
say "생성: $(date '+%Y-%m-%d %H:%M %Z')   ·   bin/status.sh$([ $OFFLINE = 1 ] && echo ' --offline')"
say "\`\`\`"
say ""
say "> **이 파일이 지금 사실이다.** \`PLAN.md\` 의 §0·§5·§6·§12 는 **기획 당시의"
say "> 판단 기록**이고 지금 사실이 아니다. 숫자를 알고 싶으면 여기를 보고,"
say "> **왜 그렇게 됐나**를 알고 싶으면 \`PLAN.md\` 의 §13.x 를 검색하라."
say ""
say "다시 만들려면: \`./bin/status.sh\`   ·   어긋났는지만 보려면: \`./bin/doc-drift.sh\`"
say ""
say "---"
say ""

# ── 1. 코드 ──────────────────────────────────────────────────────────
say "## 1. 코드"
say ""
say "| | |"
say "|---|---|"
# ★ `paste -sd' · '` 는 구분자의 **첫 글자만** 쓴다 — 가운뎃점이 깨져 나왔다.
say "| 탭 | **$(tabs_count)개** — $(tabs_list | sed -E 's/^[a-z]+://' | tr '\n' '~' | sed 's/~$//; s/~/ · /g') |"
say "| 앱 소스 | \`rn-bench/src\` $(src_files)개 파일 · $(src_lines)줄 |"
say "| 마이그레이션 | **$(count_migrations)개** · 마지막 \`$(last_migration)\` · 다음 번호 **$(printf '%03d' $(( $(count_migrations) + 1 )))** |"
say "| \`api_*\` 함수 | DB 정의 $(api_defined | wc -l | tr -d ' ')개 · 앱/웹 호출 $(api_called | wc -l | tr -d ' ')개 |"
say ""
_orphan="$(comm -23 <(api_defined) <(api_called) | wc -l | tr -d ' ')"
say "★ **아무도 안 부르는 \`api_*\` 가 $_orphan 개**다. 그중 일부는 «대체됨»이고 일부는"
say "  «화면이 아직 없음»이다 — 둘은 다르다(§13.182). 목록:"
say ""
say "\`\`\`"
comm -23 <(api_defined) <(api_called) | paste -sd' ' - | fold -s -w 76 >> "$W"
say "\`\`\`"
say ""

# ── 2. 기능 인벤토리 ─────────────────────────────────────────────────
say "## 2. 기능 — **기대와 실제**"
say ""
say "기대 상태는 \`bin/features.tsv\` 에 적혀 있다. 아래 «실제»는 **지금 재 본 것**이다."
say "둘이 다르면 \`bin/doc-drift.sh\` 가 CI 에서 막는다 — **코드가 바뀌면 표를 같이 고쳐라.**"
say ""
say "| 기능 | 기대 | 실제 | |"
say "|---|:---:|:---:|:---:|"
MISMATCH=0
while IFS=$'\t' read -r key name want scope re; do
  [ -z "${key:-}" ] && continue
  case "$key" in \#*) continue ;; esac
  got="$(probe_one "$re" "$scope")"
  if [ "$got" = "$want" ]; then mark="✓"; else mark="**⚠ 어긋남**"; MISMATCH=$((MISMATCH+1)); fi
  say "| $name | $want | $got | $mark |"
done < "$ROOT/bin/features.tsv"
say ""
if [ "$MISMATCH" = 0 ]; then
  say "**어긋난 줄 없음** — 표와 코드가 같다."
else
  say "★ **어긋난 줄 $MISMATCH 개.** 코드가 바뀐 것이라면 \`bin/features.tsv\` 의 «기대»를"
  say "  고치고, 관련 문서(\`CHECKLIST.md\`·\`PLAN.md\` §13.183 A-1)도 같이 고쳐라."
fi
say ""

# ── 3. git ───────────────────────────────────────────────────────────
say "## 3. git"
say ""
say "\`\`\`"
{
  echo "브랜치     $(git -C "$ROOT" branch --show-current 2>/dev/null)"
  echo "커밋       $(git -C "$ROOT" log -1 --format='%h %ad %s' --date=short 2>/dev/null)"
  _dirty="$(git -C "$ROOT" status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
  echo "작업본     $([ "$_dirty" = 0 ] && echo '깨끗' || echo "$_dirty 개 변경/미추적")"
  echo "stash      $(git -C "$ROOT" stash list 2>/dev/null | wc -l | tr -d ' ')개"
  echo "원격       $(git -C "$ROOT" remote get-url origin 2>/dev/null || echo '없음')"
  echo
  echo "원격이 모르는 브랜치 (로컬에만 있는 것):"
  git -C "$ROOT" for-each-ref --format='%(refname:short) %(upstream:short)' refs/heads \
    | awk '$2=="" {print "  "$1}' || true
  echo
  echo "작업 폴더(worktree):"
  git -C "$ROOT" worktree list 2>/dev/null | sed 's/^/  /'
} >> "$W"
say "\`\`\`"
say ""

# ── 4. 돌고 있는 것 ──────────────────────────────────────────────────
say "## 4. 지금 돌고 있는 것"
say ""
say "| 무엇 | |"
say "|---|---|"
_run() { # 이름, 패턴
  if pgrep -f "$2" >/dev/null 2>&1; then say "| $1 | **돌고 있다** (\`pgrep -f '$2'\`) |"
  else say "| $1 | 없음 |"; fi
}
_run "Metro / Expo 개발 서버" "expo start|metro"
_run "Gradle 데몬"            "GradleDaemon"
_port() {
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$2" -sTCP:LISTEN >/dev/null 2>&1
  then say "| $1 (포트 $2) | **열려 있다** |"; else say "| $1 (포트 $2) | 없음 |"; fi
}
_port "로컬 검증 PostgreSQL" 55432
_port "adb 서버"             5037
_port "prototype 정적 서버"  3011
_port "website 정적 서버"    3020
_port "Metro"                8081
if command -v xcrun >/dev/null 2>&1; then
  _b="$(xcrun simctl list devices booted 2>/dev/null | grep -c Booted || true)"
  say "| 부팅된 iOS 시뮬레이터 | $([ "${_b:-0}" -gt 0 ] && echo "**$_b 대**" || echo '없음') |"
else
  say "| 부팅된 iOS 시뮬레이터 | 재지 못함 (xcrun 없음) |"
fi
say ""

# ── 5. 서버·출시·웹 (자격증명·네트워크가 필요한 것) ──────────────────
say "## 5. 서버 · 출시 · 웹"
say ""
if [ "$OFFLINE" = 1 ]; then
  skip "이 절 전체 — \`--offline\` 으로 돌렸다. 네트워크 없이 다시 돌리면 빈다."
  say "\`--offline\` 이라 **재지 않았다.** \`./bin/status.sh\` 로 다시 돌려라."
  say ""
else
  say "| 무엇 | 상태 |"
  say "|---|---|"

  # 5-1 Supabase provider
  ENVL="$ROOT/rn-bench/.env.local"
  if [ -f "$ENVL" ]; then
    SURL="$(grep -m1 '^EXPO_PUBLIC_SUPABASE_URL=' "$ENVL" | cut -d= -f2-)"
    AKEY="$(grep -m1 '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ENVL" | cut -d= -f2-)"
    if [ -n "$SURL" ] && [ -n "$AKEY" ]; then
      P="$(curl -fsS --max-time 20 "$SURL/auth/v1/settings" -H "apikey: $AKEY" 2>/dev/null \
           | grep -oE '"(apple|kakao)":[a-z]+' | paste -sd' · ' -)"
      say "| 소셜 로그인 (Supabase provider) | ${P:-재지 못함 (응답 없음)} |"
      say "| Supabase 프로젝트 | \`$(echo "$SURL" | sed -E 's#https://([^.]+)\..*#\1#')\` |"
    else
      say "| 소셜 로그인 | 재지 못함 (\`.env.local\` 에 값이 없다) |"
      skip "소셜 로그인 — \`rn-bench/.env.local\` 의 URL·anon 키가 비었다"
    fi
  else
    say "| 소셜 로그인 | 재지 못함 (\`rn-bench/.env.local\` 이 없다) |"
    skip "소셜 로그인 — \`rn-bench/.env.local\` 이 없다(이관 패키지 \`1-비밀값/\` 에서 가져온다)"
  fi

  # 5-2 웹 네 장
  BASE="$(grep -m1 '^EXPO_PUBLIC_INVITE_BASE=' "$ENVL" 2>/dev/null | cut -d= -f2- | sed 's#/[^/]*$##')"
  if [ -n "$BASE" ]; then
    _codes=""
    for f in terms privacy support invite; do
      c="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/$f.html" 2>/dev/null)"
      _codes="$_codes $f:$c"
    done
    say "| 약관·초대 페이지 |$_codes |"
    say "| 그 주소 | \`$BASE/\` |"
  else
    say "| 약관·초대 페이지 | 재지 못함 (\`EXPO_PUBLIC_INVITE_BASE\` 가 없다) |"
    skip "약관·초대 페이지 — \`EXPO_PUBLIC_INVITE_BASE\` 를 못 읽었다"
  fi

  # 5-3 EAS
  if (cd "$ROOT/rn-bench" && npx --no-install eas whoami >/dev/null 2>&1); then
    say "| Expo 계정 | \`$(cd "$ROOT/rn-bench" && npx --no-install eas whoami 2>/dev/null | head -1)\` |"
    EB="$(cd "$ROOT/rn-bench" && npx --no-install eas build:list --limit 30 --non-interactive 2>/dev/null \
          | grep -E '^(Platform|Status|Started at) ' | paste - - - | awk '{print $2, $4, $7}')"
    if [ -n "$EB" ]; then
      say "| 최근 빌드 30건 | $(echo "$EB" | awk '{c[$1" "$2]++} END {for (k in c) printf "%s %d · ", k, c[k]}' | sed 's/ · $//') |"
      say "| 가장 최근 | $(echo "$EB" | head -1) |"
    else
      say "| 최근 빌드 | 재지 못함 |"; skip "EAS 빌드 목록 — \`eas build:list\` 가 비었다"
    fi
    ES="$(cd "$ROOT/rn-bench" && npx --no-install eas submit:list --limit 5 --non-interactive 2>/dev/null \
          | grep -E '^(Platform|Status|Started at) ' | paste - - - | awk '{print $2, $4, $7}' | head -3)"
    if [ -n "$ES" ]; then
      say "| **스토어 제출** | $(echo "$ES" | paste -sd' / ' -) |"
    else
      say "| 스토어 제출 | **없다** (한 번도 제출 안 됨) |"
    fi
  else
    say "| Expo 계정 · 빌드 · 제출 | 재지 못함 (\`eas\` 로그인이 안 돼 있다) |"
    skip "EAS — 로그인 안 됨. \`cd rn-bench && npx eas login\` 뒤 다시 돌려라. 무료 플랜 **남은 빌드 수는 CLI 로 안 보인다** → expo.dev → Billing"
  fi

  # 5-4 DB 표류
  if [ -f "$ROOT/.env" ] && grep -q '^DB_URL=' "$ROOT/.env" 2>/dev/null; then
    say "| 서버 표류 (코드 ↔ 실서버) | \`./db/local/verify.sh\` 로 본다 — 여기서는 안 돌린다(30초) |"
  else
    say "| 서버 표류 | 재지 못함 (\`.env\` 의 \`DB_URL\` 이 없다) |"
    skip "서버 표류 — \`.env\` 의 \`DB_URL\` 이 없다(이관 패키지 \`1-비밀값/\`)"
  fi
  say ""
fi

# ── 6. 못 잰 것 ──────────────────────────────────────────────────────
say "## 6. 이 파일이 **재지 못한 것**"
say ""
say "★ 비워 두면 **못 잰 것이 사실로 둔갑한다.** 아래는 «모른다 + 어디를 열면 보이나» 다."
say ""
if [ ${#NOTE[@]} -gt 0 ]; then
  for n in "${NOTE[@]}"; do say "- $n"; done
  say ""
fi
say "**명령으로는 영영 못 재는 것** — 사람이 열어 봐야 한다:"
say ""
say "| 무엇 | 어디를 열면 보이나 |"
say "|---|---|"
say "| EAS 무료 플랜 **남은 빌드 수** | expo.dev → 계정 → Billing |"
say "| App Store Connect **무료 앱 계약** 동의 | appstoreconnect.apple.com → 계약, 세금 및 금융 거래 |"
say "| App ID 의 **Sign in with Apple** capability | developer.apple.com → Identifiers → \`app.trippic\` |"
say "| TestFlight **내부/외부 테스터** 상태 | App Store Connect → 트립픽 → TestFlight |"
say "| Supabase · 카카오 · 공공데이터 **계정 소유자** | 각 대시보드 (→ \`DECISIONS.md\`) |"
say "| Google Play 개발자 계정 유무 | play.google.com/console (→ \`DECISIONS.md\`) |"
say ""
say "**사람이 정해야 하는 것**(아직 안 정해진 것)은 \`DECISIONS.md\` 에 있다."

# ── 내보내기 ─────────────────────────────────────────────────────────
if [ "$OUT" = "-" ]; then cat "$W"; else cp "$W" "$OUT"; echo "→ $OUT ($(wc -l < "$OUT" | tr -d ' ')줄)"; fi
[ "$MISMATCH" = 0 ] || echo "⚠ 기능 표와 코드가 $MISMATCH 곳 어긋난다 — ./bin/doc-drift.sh 를 보라" >&2
exit 0
