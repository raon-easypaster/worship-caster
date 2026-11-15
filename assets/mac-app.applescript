-- 예배송출 맥 앱 (만든 사람: 쉬운목사 이광복)
-- 켜져 있는 동안 독에 머묾. 독 아이콘을 누르면 운영 화면을 앞으로, 독에서 종료하면 예배송출도 끔.
-- build-dist.sh 가 __PORT__ 를 바꿔 넣고 osacompile -s 로 '계속 열려 있는 앱'으로 만듦
property PORT : "__PORT__"
property started : false

on base()
	return "http://localhost:" & PORT
end base

on alive()
	try
		do shell script "curl -s -m 1 -o /dev/null -w '%{http_code}' " & base() & "/api/me | grep -q 200"
		return true
	on error
		return false
	end try
end alive

on run
	set R to (POSIX path of (path to me)) & "Contents/Resources/"
	set dataDir to (POSIX path of (path to home folder)) & "Library/Application Support/WorshipCaster"
	set logFile to (POSIX path of (path to home folder)) & "Library/Logs/WorshipCaster.log"
	if alive() then
		-- 이미 켜져 있음 (예전 방식으로 켠 것 등): 운영 화면만 앞으로
		my showUI()
	else
		-- 애플 칩(M1~)이면 애플 칩용으로 바로 실행
		set runArch to ""
		try
			if (do shell script "sysctl -n hw.optional.arm64 2>/dev/null") is "1" then set runArch to "arch -arm64 "
		end try
		do shell script "mkdir -p " & quoted form of dataDir & " " & quoted form of ((POSIX path of (path to home folder)) & "Library/Logs") & "; cd " & quoted form of (R & "app") & " && WC_DATA_DIR=" & quoted form of dataDir & " PORT=" & PORT & " nohup " & runArch & quoted form of (R & "node/node") & " server.js >> " & quoted form of logFile & " 2>&1 &"
		set started to true
		repeat 50 times
			if alive() then exit repeat
			delay 0.2
		end repeat
		if not alive() then
			display alert "예배송출" message "프로그램을 시작하지 못했습니다. 기록 파일: " & logFile as critical
			quit
		end if
	end if
end run

on showUI()
	try
		do shell script "curl -s -m 3 -X POST -H 'Origin: " & base() & "' " & base() & "/api/show > /dev/null"
	end try
end showUI

-- 독 아이콘을 다시 누름 → 운영 화면을 앞으로 (닫혀 있으면 다시 엶)
on reopen
	if alive() then
		my showUI()
	else
		run
	end if
end reopen

-- 운영 화면의 ⏻ 종료로 꺼졌으면 독에서도 사라짐
on idle
	if not alive() then
		delay 1
		if not alive() then quit
	end if
	return 3
end idle

-- 독에서 종료 → 예배송출도 끔 (창이 함께 닫힘)
on quit
	if alive() then
		try
			do shell script "curl -s -m 3 -X POST -H 'Content-Type: application/json' -H 'Origin: " & base() & "' " & base() & "/api/quit > /dev/null"
		end try
	end if
	continue quit
end quit
