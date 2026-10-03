-- ─── ag inbox: quick entry (both Command keys) ──────────────────────────────────
-- Press both Command keys together anywhere to open Ag Desktop's quick entry box (macos-apps/AgDesktop/entry.js),
-- which sends the prompt to the ag inbox (a new Inbox session; Enter sends, Cmd+Enter sends and pins).
-- Hold Shift as well to include a screenshot: the screen under the focused window is grabbed here first (so the
-- box isn't in it) and always attached. Hammerspoon only detects the chord and takes the screenshot, because a
-- modifier-only chord can't be a global shortcut in Electron; Ag Desktop draws the box.
-- Only on Macs with Ag Desktop installed (the client).
local M = {}

local APP = os.getenv("HOME") .. "/Applications/Ag Desktop.app"
local DIR = os.getenv("HOME") .. "/Library/Caches/ag-inbox"
if not hs.fs.attributes(APP) then
	return M
end
hs.fs.mkdir(DIR)

-- Old screenshots that were never sent (closed with Esc) are cleared after a day.
local function sweep()
	for file in hs.fs.dir(DIR) do
		local p = DIR .. "/" .. file
		local mod = file:match("%.jpg$") and hs.fs.attributes(p, "modification")
		if mod and os.time() - mod > 86400 then
			os.remove(p)
		end
	end
end

function M.open(withShot)
	local q = {}
	if withShot then
		local win = hs.window.focusedWindow()
		local screen = (win and win:screen()) or hs.screen.mainScreen()
		local snap = screen:snapshot() -- nil without Screen Recording permission
		if snap then
			local f = screen:fullFrame()
			local file = string.format("%s/%s-%s.jpg", DIR, os.date("%Y%m%d-%H%M%S"), hs.host.uuid():sub(1, 6))
			snap:copy():size({ w = f.w, h = f.h }):saveToFile(file, true, "jpg") -- 1x JPEG, ~0.4 MB
			local front = hs.application.frontmostApplication()
			q = { shot = file, app = front and front:name() or "", window = win and win:title() or "" }
		end
	end
	local parts = {}
	for k, v in pairs(q) do
		table.insert(parts, k .. "=" .. hs.http.encodeForQuery(v))
	end
	hs.task.new("/usr/bin/open", nil, { "-a", APP, "agdesktop://entry?" .. table.concat(parts, "&") }):start()
	sweep()
end

-- Both Command keys down at once (left + right device flags), Shift optional. Fires once per press.
local raw = hs.eventtap.event.rawFlagMasks
local fired = false
M.tap = hs.eventtap.new({ hs.eventtap.event.types.flagsChanged }, function(e)
	local r = e:rawFlags()
	local left, right = (r & raw.deviceLeftCommand) ~= 0, (r & raw.deviceRightCommand) ~= 0
	if left and right then
		if not fired then
			fired = true
			local shift = e:getFlags().shift == true
			hs.timer.doAfter(0, function() M.open(shift) end)
		end
	elseif not left and not right then
		fired = false
	end
	return false
end):start()
-- macOS disables a tap that once ran slow; turn it back on.
M.watchdog = hs.timer.doEvery(5, function()
	if not M.tap:isEnabled() then
		M.tap:start()
	end
end)

return M
