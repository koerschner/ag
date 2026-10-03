-- ag's client-side Hammerspoon glue. Stowed from the ag repo (hammerspoon/) into ~/.hammerspoon;
-- dotfiles' init.lua loads it with `pcall(require, "ag")`, so a machine without ag still works.
-- Everything here serves the agent system: role-specific power/activity, Ghostty → tmux shortcut forwarding
-- (the keys ag-rule ag-session-keys), and the hammerspoon hook of ag-rules: the user's plain-English rules
-- with Lua code (~/ag/ag-rules, `on: hammerspoon`), such as quick entry and screenshot paste.

-- Always-on Macs only (host or extremity): clients sleep normally (see the Power section of dotfiles' macos).
if os.execute(os.getenv("HOME") .. "/.local/bin/ag-machine-role host extremity") then
	require("battery_guard")
else
	-- Client only: lock/unlock, sleep/wake, app switches for the time review (pulled by ag-mac's ag-presence poll).
	activity_log = require("activity_log")
end

-- ag-rules (~/ag/ag-rules/README.md): `ag-rules` lists them; rules read here are only the enabled ones.
local AG_RULES = os.getenv("HOME") .. "/.local/bin/ag-rules"
local function agRulesJson(args)
	local out, ok = hs.execute(AG_RULES .. " " .. args)
	return ok and hs.json.decode(out) or nil
end

-- ─── Sessions: forward Ghostty tab/split shortcuts into Ag's tmux ──────────
-- When the focused Ghostty window shows Ag's sessions (detected via the window
-- title "ag: …" that set-titles-string writes; see ~/.config/ag/ag.tmux.conf),
-- translate Ghostty's tab/split shortcuts into tmux's prefix (ctrl+b) chords.
-- Anywhere else the keys pass through untouched, so Ghostty keeps its defaults.
local MUX_PREFIX = { mods = { "ctrl" }, key = "b" }
-- Every shortcut is just a prefix chord, so it works the same locally and
-- through `ag` (ssh to the session host): tmux runs any helper script there.
-- The table comes from the keys ag-rule ag-session-keys (`ag-rules keys ag-session`; tmux/SHORTCUTS.md):
-- each `keys` (e.g. cmd+shift+d) sends prefix + `prefix`.
local MUX_KEY_NAMES = { minus = "-" }
local agShortcuts = {}
do
	local spec = agRulesJson("keys ag-session")
	for _, sc in ipairs(spec and spec.bindings or {}) do
		local mods, key = {}, nil
		for part in sc.keys:gmatch("[^+]+") do
			if part == "cmd" or part == "shift" or part == "ctrl" or part == "alt" then
				mods[part] = true
			else
				key = part
			end
		end
		local sent = MUX_KEY_NAMES[sc.prefix] or sc.prefix
		if key == "1..9" then
			for i = 1, 9 do
				table.insert(agShortcuts, { mods = mods, key = tostring(i), send = { {}, tostring(i) } })
			end
		else
			table.insert(agShortcuts, { mods = mods, key = key, send = { {}, sent } })
		end
	end
	-- For ag-shortcuts-check: what this Mac actually loaded, spec-shaped.
	agShortcuts_loaded = {}
	for _, sc in ipairs(agShortcuts) do
		local names = {}
		for m in pairs(sc.mods) do
			table.insert(names, m)
		end
		table.sort(names)
		table.insert(agShortcuts_loaded, { mods = names, key = sc.key, send = sc.send[2] })
	end
	if #agShortcuts == 0 then
		hs.alert.show("Ag shortcuts: the ag-rule ag-session-keys didn't load (ag-rules keys ag-session)")
	end
end

local function focusedWindowIsAg()
	local app = hs.application.frontmostApplication()
	if not app or app:name() ~= "Ghostty" then
		return false
	end
	local win = app:focusedWindow()
	local title = win and win:title() or ""
	return title:match("^ag: ") ~= nil
end

local function flagsMatch(flags, wanted)
	for _, m in ipairs({ "cmd", "shift", "ctrl", "alt" }) do
		if (flags[m] or false) ~= (wanted[m] or false) then
			return false
		end
	end
	return true
end

ag_shortcut_tap = hs.eventtap
	.new({ hs.eventtap.event.types.keyDown }, function(evt)
		local flags = evt:getFlags()
		if not flags["cmd"] then
			return false
		end
		local key = hs.keycodes.map[evt:getKeyCode()]
		for _, sc in ipairs(agShortcuts) do
			if key == sc.key and flagsMatch(flags, sc.mods) then
				if not focusedWindowIsAg() then
					return false
				end
				local ev = hs.eventtap.event
				local mods, k = sc.send[1], sc.send[2]
				return true, {
					ev.newKeyEvent(MUX_PREFIX.mods, MUX_PREFIX.key, true),
					ev.newKeyEvent(MUX_PREFIX.mods, MUX_PREFIX.key, false),
					ev.newKeyEvent(mods, k, true),
					ev.newKeyEvent(mods, k, false),
				}
			end
		end
		return false
	end)
	:start()

-- ─── ag-rules: the hammerspoon hook ─────────────────────────────────────────
-- Each enabled `on: hammerspoon` rule's Lua runs here, with `agLib` (below) for what rules share. A rule's
-- chunk returns a table (kept in ag_rules[name], so its taps and timers stay alive).
agLib = {
	focusedWindowIsAg = focusedWindowIsAg, -- a Ghostty window showing Ag's sessions has focus
	flagsMatch = flagsMatch, -- event flags equal exactly these modifiers
	isHost = os.execute(os.getenv("HOME") .. "/.local/bin/ag-machine-role host") == true,
}
ag_rules = {}
for _, r in ipairs(agRulesJson("list --json") or {}) do
	if r.enabled and r.on == "hammerspoon" and r.path then
		local ok, mod = pcall(dofile, r.path)
		if ok then
			ag_rules[r.name] = mod or true
		else
			hs.alert.show("ag-rules: " .. r.name .. " failed: " .. tostring(mod), 6)
		end
	end
end
