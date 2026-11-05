-- freeform-export.applescript — export one Freeform board as a PDF (run on ag-mac's screen queue).
-- Usage: osascript freeform-export.applescript "<board name>" "<output dir>" "<file name without .pdf>"
-- Called by ag-freeform-export; see its header. Needs Freeform's iCloud sync on (System Settings > iCloud).

on run argv
	set boardName to item 1 of argv
	set outDir to item 2 of argv
	set outName to item 3 of argv
	set wasRunning to application "Freeform" is running
	tell application "Freeform" to activate
	-- A cold start has to pull the day's edits from iCloud first.
	if not wasRunning then delay 30
	tell application "System Events" to tell process "Freeform"
		set frontmost to true
		repeat 30 times
			if (count of windows) > 0 then exit repeat
			delay 1
		end repeat
		if (count of windows) = 0 then click menu item "New Window" of menu "File" of menu bar 1
		delay 1
		if not (exists window boardName) then
			my showAllBoards()
			set lst to UI element 1 of UI element 1 of scroll area 2 of splitter group 1 of window "All Boards"
			set hit to missing value
			repeat with b in (buttons of lst)
				if (description of b) starts with ("Board: " & boardName & ",") then
					set hit to b
					exit repeat
				end if
			end repeat
			if hit is missing value then error "no Freeform board named " & boardName
			perform action "AXPress" of hit
			repeat 20 times
				if exists window boardName then exit repeat
				delay 1
			end repeat
			if not (exists window boardName) then error "board did not open: " & boardName
			delay 2
		end if
		perform action "AXRaise" of window boardName
		delay 0.5
		click menu item "Export Board as PDF…" of menu "File" of menu bar 1
		repeat 15 times
			if exists window "Export as PDF" then exit repeat
			delay 1
		end repeat
		if not (exists window "Export as PDF") then error "export dialog did not open"
		delay 0.5
		keystroke "a" using command down
		keystroke outName
		delay 0.3
		keystroke "g" using {command down, shift down}
		delay 1
		keystroke outDir
		delay 0.5
		key code 36 -- go to the folder
		delay 1.5
		key code 36 -- Export (default button)
		repeat 30 times
			if not (exists window "Export as PDF") then exit repeat
			delay 1
		end repeat
		if exists window "Export as PDF" then
			key code 53
			error "export dialog stuck open"
		end if
		-- Leave Freeform on the boards list, running, so iCloud keeps it current for the next run.
		delay 1
		my showAllBoards()
	end tell
	return "exported " & outDir & "/" & outName & ".pdf"
end run

on showAllBoards()
	tell application "System Events" to tell process "Freeform"
		repeat 5 times
			if exists window "All Boards" then return
			try
				click (first button of toolbar 1 of window 1 whose description is "Go Back")
			end try
			delay 1.5
		end repeat
		if not (exists window "All Boards") then error "could not get back to All Boards"
	end tell
end showAllBoards
