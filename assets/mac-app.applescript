-- 예배송출 맥 앱 (만든 사람: 쉬운목사 이광복)
-- 켜져 있는 동안 독에 머묾. 독 아이콘을 누르면 운영 화면을 앞으로(꺼져 있으면 다시 켬), 독에서 종료하면 예배송출도 끔.
-- build-dist.sh 가 __PORT__ 를 바꿔 넣고 osacompile -s 로 '계속 열려 있는 앱'으로 만듦
-- 주의: 알림 창(display alert)처럼 앱을 붙잡는 것은 쓰지 않음 — 붙잡히면 독 아이콘·종료가 안 먹힘
property PORT : "__PORT__"
property startedAt : 0
property missCount : 0
property everAlive : false

on base()
	return "http://localhost:" & PORT
end base

on alive()
	try
		do shell script "curl -s -m 1 -o /dev/null -w '%{http_code}' " & my base() & "/api/me | grep -q 200"
		return true
	on error
		return false
	end try
end alive

on nowSec()
	return (do shell script "date +%s") as integer
end nowSec

-- 서버(본체)를 켬. 기다리지 않고 바로 돌아옴 (켜지는 것은 idle 이 지켜봄)
on startServer()
	set R to (POSIX path of (path to me)) & "Contents/Resources/"
	set home to POSIX path of (path to home folder)
	set dataDir to home & "Library/Application Support/WorshipCaster"
	set logFile to home & "Library/Logs/WorshipCaster.log"
	set runArch to ""
	try
		if (do shell script "sysctl -n hw.optional.arm64 2>/dev/null") is "1" then set runArch to "arch -arm64 "
	end try
	-- 'cd … && 명령 &' 꼴은 껍데기가 본체를 기다리며 붙잡혀 독 앱이 멈춤 → cd 를 따로 하고 본체만 뒤로 보냄
	do shell script "mkdir -p " & quoted form of dataDir & " " & quoted form of (home & "Library/Logs") & "; cd " & quoted form of (R & "app") & " || exit 1; WC_DATA_DIR=" & quoted form of dataDir & " PORT=" & PORT & " nohup " & runArch & quoted form of (R & "node/node") & " server.js < /dev/null >> " & quoted form of logFile & " 2>&1 &"
	set startedAt to my nowSec()
	set missCount to 0
end startServer

on showUI()
	try
		do shell script "curl -s -m 3 -X POST -H 'Origin: " & my base() & "' " & my base() & "/api/show > /dev/null"
	end try
end showUI

on run
	if my alive() then
		set everAlive to true
		my showUI()   -- 이미 켜져 있음: 운영 화면만 앞으로
	else
		my startServer()   -- 본체가 켜지면 운영 화면을 스스로 엶
	end if
end run

-- 독 아이콘을 다시 누름 → 켜져 있으면 운영 화면을 앞으로, 꺼져 있으면 다시 켬
on reopen
	if my alive() then
		my showUI()
	else if (my nowSec()) - startedAt > 3 then   -- 막 켠 직후 두 번 눌러 두 번 켜지 않게
		my startServer()
	end if
end reopen

-- 3초마다: 본체가 꺼졌으면(⏻ 종료 등) 독에서도 사라짐. 막 켜는 중(90초 안)에는 기다림
on idle
	if my alive() then
		set missCount to 0
		set everAlive to true
	else if (my nowSec()) - startedAt > 90 then
		set missCount to missCount + 1
		if missCount ≥ 2 then
			if not everAlive then display notification "프로그램을 시작하지 못했습니다. 기록 파일: ~/Library/Logs/WorshipCaster.log" with title "예배송출"
			quit
		end if
	end if
	return 3
end idle

-- 독에서 종료 → 예배송출도 끔 (창이 함께 닫힘)
on quit
	try
		if my alive() then do shell script "curl -s -m 3 -X POST -H 'Content-Type: application/json' -H 'Origin: " & my base() & "' " & my base() & "/api/quit > /dev/null"
	end try
	continue quit
end quit
