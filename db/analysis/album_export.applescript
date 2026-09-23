(*
  실제 앨범에서 **촬영시각과 좌표만** 뽑는다.
  파일명·인물·앨범·키워드는 읽지 않는다. 사진 자체도 열지 않는다.
  결과는 로컬 TSV 한 장이고 어디로도 보내지 않는다.

  ★ 한 장씩 도는 대신 속성별로 한 번에 가져온다 —
    AppleScript에서 media item 하나씩 접근하면 수천 장에 수십 분이 걸린다.

  실행: osascript db/analysis/album_export.applescript > data/out/album_real.tsv
*)
tell application "Photos"
	set ds to date of every media item
	set ls to location of every media item
end tell

set AppleScript's text item delimiters to tab
set out to {}
set n to count of ds
repeat with i from 1 to n
	set d to item i of ds
	set L to item i of ls
	if L is not missing value and d is not missing value then
		set la to item 1 of L
		set lo to item 2 of L
		if la is not missing value and lo is not missing value then
			-- epoch 초로 바꾼다 (1970-01-01 기준)
			set secs to (d - (date "Thursday, January 1, 1970 at 00:00:00"))
			set end of out to ((secs as integer) as text) & tab & (la as text) & tab & (lo as text)
		end if
	end if
end repeat
set AppleScript's text item delimiters to linefeed
return out as text
