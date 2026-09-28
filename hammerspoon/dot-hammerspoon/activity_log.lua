-- Activity log (clients only): event-driven, no timers or polling.
-- Appends one JSON line per event to ~/.local/state/activity/events.jsonl:
--   hs_start (Hammerspoon launched: login or reload, with boot time), lock/unlock,
--   sleep/wake, screens off/on, session active/inactive (fast user switching),
--   power off, screensaver, and app launched/terminated/activated (name, bundle id,
--   front window title at activation).
-- ag pulls new lines on its existing 30s presence poll (same SSH round trip), so this
-- module never talks to the network. Text only; no screenshots.
local M = {}

local dir = os.getenv("HOME") .. "/.local/state/activity"
local path = dir .. "/events.jsonl"
os.execute("mkdir -p '" .. dir .. "'")

local function write(ev)
	ev.ts = os.date("!%Y-%m-%dT%H:%M:%SZ")
	local ok, line = pcall(hs.json.encode, ev)
	if not ok then return end
	local f = io.open(path, "a")
	if f then
		f:write(line, "\n")
		f:close()
	end
end

local cw = hs.caffeinate.watcher
local names = {
	[cw.screensDidLock] = "lock",
	[cw.screensDidUnlock] = "unlock",
	[cw.systemWillSleep] = "sleep",
	[cw.systemDidWake] = "wake",
	[cw.screensDidSleep] = "screens_off",
	[cw.screensDidWake] = "screens_on",
	[cw.sessionDidResignActive] = "session_inactive",
	[cw.sessionDidBecomeActive] = "session_active",
	[cw.systemWillPowerOff] = "power_off",
	[cw.screensaverDidStart] = "screensaver_on",
	[cw.screensaverDidStop] = "screensaver_off",
}
M.power = cw.new(function(e)
	if names[e] then write({ ev = names[e] }) end
end):start()

local aw = hs.application.watcher
local appEvents = { [aw.launched] = "app_launch", [aw.terminated] = "app_quit", [aw.activated] = "app_front" }
M.apps = aw.new(function(name, e, app)
	local kind = appEvents[e]
	if not kind then return end
	local ev = { ev = kind, app = name, bundle = app and app:bundleID() or nil }
	if kind == "app_front" and app then
		local w = app:focusedWindow()
		local t = w and w:title() or ""
		if t ~= "" then ev.window = t:sub(1, 160) end
	end
	write(ev)
end):start()

local boot = hs.execute("sysctl -n kern.boottime"):match("sec = (%d+)")
write({ ev = "hs_start", boot = boot and os.date("!%Y-%m-%dT%H:%M:%SZ", tonumber(boot)) or nil, user = os.getenv("USER") })

return M
