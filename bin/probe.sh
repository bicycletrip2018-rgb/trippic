#!/usr/bin/env bash
# =====================================================================
# 재는 함수들 — `status.sh` 와 `doc-drift.sh` 가 **같은 것을 쓴다** (§13.184)
#
# ★ 왜 갈라 뒀나 — 생성하는 쪽(`status.sh`)과 막는 쪽(`doc-drift.sh`)이 재는
#   방법을 따로 가지면 **둘이 어긋난다.** 그리고 어긋나는 쪽은 늘 안 보는 쪽이다.
#   (`db-verify.yml` 이 *"CI 전용 검사를 따로 만들면 둘이 어긋난다"* 고 적은 것과
#    같은 이유다.)
#
# 이 파일은 **직접 돌리지 않는다.** source 해서 쓴다.
# =====================================================================
# ★ `BASH_SOURCE` 는 zsh 로 source 하면 **빈 문자열**이다 → `dirname ""` = `.` 이 되어
#   엉뚱한 폴더를 가리킨다(실제로 한 번 그렇게 0 개를 셌다). 저장소 뿌리는
#   **git 에게 묻는 것**이 가장 안 틀린다. git 이 없을 때만 경로로 되짚는다.
ROOT="${TRIPPIC_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null)}"
if [ -z "$ROOT" ] || [ ! -d "$ROOT/db/migrations" ]; then
  _self="${BASH_SOURCE[0]:-$0}"
  ROOT="$(cd "$(dirname "$_self")/.." 2>/dev/null && pwd)"
fi
[ -d "$ROOT/db/migrations" ] || { echo "probe.sh: 저장소 뿌리를 못 찾았다 (ROOT=$ROOT)" >&2; return 1 2>/dev/null || exit 1; }

# ── 범위를 실제 경로로 ───────────────────────────────────────────────
scope_paths() {
  case "$1" in
    src)   echo "$ROOT/rn-bench/src" ;;
    db)    echo "$ROOT/db/migrations" ;;
    web)   echo "$ROOT/website" ;;
    srcdb) echo "$ROOT/rn-bench/src $ROOT/db/migrations" ;;
    *)     echo "" ;;
  esac
}

# 기능 하나를 잰다 → "있음" 또는 "없음"
#   ★ `rn-bench/build-test/` 는 `src` 의 **컴파일 사본**이다. 같이 세면
#     지운 코드가 한참 «있음» 으로 남는다. `src` 만 본다(scope_paths 가 그렇게 준다).
probe_one() {
  local re="$1" scope="$2" paths
  paths="$(scope_paths "$scope")"
  [ -z "$paths" ] && { echo "범위오류"; return; }
  # shellcheck disable=SC2086
  if grep -rlEq -- "$re" $paths 2>/dev/null; then echo "있음"; else echo "없음"; fi
}

# ── 숫자로 재는 것들 ─────────────────────────────────────────────────
count_migrations() { ls "$ROOT"/db/migrations/*.sql 2>/dev/null | wc -l | tr -d ' '; }
last_migration()   { ls "$ROOT"/db/migrations/*.sql 2>/dev/null | tail -1 | xargs -r basename; }

# 탭 **목록**을 TabBar.tsx 에서 뽑는다 — 숫자를 손으로 적지 않는다
#   ["map", "🗺️", "지도"] 꼴에서 첫째와 셋째를 꺼낸다
tabs_list() {
  sed -n '/^const TABS/,/^];/p' "$ROOT/rn-bench/src/TabBar.tsx" 2>/dev/null \
    | grep -oE '\["[a-z]+", *"[^"]*", *"[^"]+"\]' \
    | sed -E 's/\["([a-z]+)", *"[^"]*", *"([^"]+)"\]/\1:\2/'
}
tabs_count() { tabs_list | grep -c . ; }

src_files() { find "$ROOT/rn-bench/src" -type f \( -name '*.ts' -o -name '*.tsx' \) | wc -l | tr -d ' '; }
src_lines() { find "$ROOT/rn-bench/src" -type f \( -name '*.ts' -o -name '*.tsx' \) -exec cat {} + | wc -l | tr -d ' '; }

# db 에 **정의된** api_* 와 앱이 **부르는** api_* — 차이가 «길이 없는 함수» 다
api_defined() {
  grep -rhoE 'function +public\.(api_[a-z0-9_]+)' "$ROOT/db/migrations" 2>/dev/null \
    | sed -E 's/.*public\.//' | sort -u
}
# 부르는 모양은 둘이다 — rpc("api_x") 와 fetch(`…/rest/v1/rpc/api_x`).
# ★ 둘째를 안 보면 invite.html 의 api_invite_preview 가 «아무도 안 부른다»로 잡혔다.
#   백틱으로 감싼 `api_x` 는 **주석**이라 세지 않는다(features.tsv ★★ 와 같은 함정).
api_called() {
  grep -rhoE '"api_[a-z0-9_]+"|/rpc/api_[a-z0-9_]+' "$ROOT/rn-bench/src" "$ROOT/website" 2>/dev/null \
    | sed -E 's#^/rpc/##' | tr -d '"' | sort -u
}
