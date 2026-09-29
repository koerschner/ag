-- ag's client-side Hammerspoon glue. Stowed from the ag repo (hammerspoon/) into ~/.hammerspoon;
-- dotfiles' init.lua loads it with `pcall(require, "ag")`, so a machine without ag still works.
-- Everything here serves the agent system: role-specific power/activity, the ag inbox capture,
-- Ghostty → Herdr shortcut forwarding, image paste into remote agents, and herdr:// tab links.

-- Host only: clients sleep normally (see the Power section of dotfiles' macos).
if os.execute(os.getenv("HOME") .. "/.local/bin/machine-role host") then
	require("battery_guard")
else
	-- Client only: lock/unlock, sleep/wake, app switches for the time review (pulled by ag-mac's presence poll).
	activity_log = require("activity_log")
end

-- ag inbox quick capture (Cmd+Shift+Space): prompt + screenshot → new pi session on ag.
ag_inbox = require("ag_inbox")

-- ─── Herdr: forward Ghostty tab/split shortcuts into herdr ─────────────────
-- When the focused Ghostty window is running herdr (detected via the window
-- title herdr writes; see ui.window_title in ~/.config/herdr/config.toml),
-- translate Ghostty's tab/split shortcuts into herdr's prefix (ctrl+b) chords.
-- Anywhere else the keys pass through untouched, so Ghostty keeps its defaults.
local HERDR_PREFIX = { mods = { "ctrl" }, key = "b" }
-- Every shortcut is just a prefix chord, so it works the same locally and
-- through `herdr --remote` (ag-mac): herdr runs any helper script on the server.
-- The table comes from the canonical spec, ~/.config/herdr/shortcuts.json
-- (herdr/SHORTCUTS.md): each `key` (e.g. cmd+shift+d) sends prefix + `prefix`.
local HERDR_KEY_NAMES = { minus = "-" }
local herdrShortcuts = {}
do
	local spec = hs.json.read(os.getenv("HOME") .. "/.config/herdr/shortcuts.json")
	for _, sc in ipairs(spec and spec.shortcuts or {}) do
		local mods, key = {}, nil
		for part in sc.key:gmatch("[^+]+") do
			if part == "cmd" or part == "shift" or part == "ctrl" or part == "alt" then
				mods[part] = true
			else
				key = part
			end
		end
		local sent = HERDR_KEY_NAMES[sc.prefix] or sc.prefix
		if key == "1..9" then
			for i = 1, 9 do
				table.insert(herdrShortcuts, { mods = mods, key = tostring(i), send = { {}, tostring(i) } })
			end
		else
			table.insert(herdrShortcuts, { mods = mods, key = key, send = { {}, sent } })
		end
	end
	-- For herdr-shortcuts-check: what this Mac actually loaded, spec-shaped.
	herdrShortcuts_loaded = {}
	for _, sc in ipairs(herdrShortcuts) do
		local names = {}
		for m in pairs(sc.mods) do
			table.insert(names, m)
		end
		table.sort(names)
		table.insert(herdrShortcuts_loaded, { mods = names, key = sc.key, send = sc.send[2] })
	end
	if #herdrShortcuts == 0 then
		hs.alert.show("Herdr shortcuts: ~/.config/herdr/shortcuts.json missing")
	end
end

local function focusedWindowIsHerdr()
	local app = hs.application.frontmostApplication()
	if not app or app:name() ~= "Ghostty" then
		return false
	end
	local win = app:focusedWindow()
	local title = win and win:title() or ""
	return title:match("^herdr") ~= nil
end

local function flagsMatch(flags, wanted)
	for _, m in ipairs({ "cmd", "shift", "ctrl", "alt" }) do
		if (flags[m] or false) ~= (wanted[m] or false) then
			return false
		end
	end
	return true
end

herdr_shortcut_tap = hs.eventtap
	.new({ hs.eventtap.event.types.keyDown }, function(evt)
		local flags = evt:getFlags()
		if not flags["cmd"] then
			return false
		end
		local key = hs.keycodes.map[evt:getKeyCode()]
		for _, sc in ipairs(herdrShortcuts) do
			if key == sc.key and flagsMatch(flags, sc.mods) then
				if not focusedWindowIsHerdr() then
					return false
				end
				local ev = hs.eventtap.event
				local mods, k = sc.send[1], sc.send[2]
				return true, {
					ev.newKeyEvent(HERDR_PREFIX.mods, HERDR_PREFIX.key, true),
					ev.newKeyEvent(HERDR_PREFIX.mods, HERDR_PREFIX.key, false),
					ev.newKeyEvent(mods, k, true),
					ev.newKeyEvent(mods, k, false),
				}
			end
		end
		return false
	end)
	:start()

-- ─── Herdr: paste images into remote (ag-mac) agents ────────────────────────
-- Herdr runs on ag-mac, so an image on this Mac's clipboard can't reach pi there.
-- Cmd+V in a Herdr window with an image (or copied image files) on the clipboard:
-- upload it to ag-mac:~/inbox/clipboard/ and type the remote path instead. Pi reads
-- image paths as attachments. Plain text pastes are untouched. Skipped on the host itself.
local PASTE_HOST = "ag-mac"
-- This Mac's LocalHostName, and whether it is the Herdr host (machines/README.md via machine-role).
local THIS_HOST = (hs.execute("scutil --get LocalHostName"):gsub("%s", ""))
local IS_HOST = select(2, hs.execute(os.getenv("HOME") .. "/.local/bin/machine-role host")) == true
local PASTE_DIR = "inbox/clipboard"
local PASTE_REMOTE_HOME = "/Users/natkoersch" -- ag-mac's home; pi wants absolute paths
local IMAGE_EXT = { png = true, jpg = true, jpeg = true, gif = true, webp = true, heic = true }

-- Returns { {src=<local file>, ext=<remote ext>, convert=<bool>} ... } or nil. No image
-- encoding happens here: copied files are used as-is, and a raw clipboard image is
-- written as its raw bytes (instant); PNG conversion happens after the path is typed.
local function clipboardImages()
	local out = {}
	for _, u in ipairs(hs.pasteboard.readURL(nil, true) or {}) do
		local path = u.filePath
		local ext = path and (path:match("%.(%w+)$") or ""):lower()
		if ext and IMAGE_EXT[ext] then
			table.insert(out, { src = path, ext = ext })
		end
	end
	if #out > 0 then
		return out
	end
	for _, uti in ipairs({ "public.png", "public.tiff" }) do
		local data = hs.pasteboard.readDataForUTI(uti)
		if data and #data > 0 then
			local tmp = os.tmpname()
			local f = io.open(tmp, "wb")
			f:write(data)
			f:close()
			return { { src = tmp, ext = "png", convert = uti == "public.tiff", tmp = true } }
		end
	end
	return nil
end

local function shq(s)
	return "'" .. (s:gsub("'", "'\\''")) .. "'"
end

-- Type the (deterministic) remote paths immediately, upload in the background over one
-- multiplexed ssh connection (ControlMaster in ssh config). The upload finishes long
-- before you hit Enter; an alert appears only if it fails.
-- Pre-upload: every CleanShot capture is pushed to ag the moment it's written, so by
-- the time you press Cmd+V the file is already there and the paste just types its path.
-- CleanShot copies a file URL to its media folder PNG, which is matched against this map.
herdr_preuploaded = {} -- local path -> remote path
local preuploaded = herdr_preuploaded
local function uploadCmd(src, name, convert, tmp)
	local q = shq(src)
	local prep = convert and ("sips -s format png " .. q .. " --out " .. q .. ".png >/dev/null && ") or ""
	local up = convert and (q .. ".png") or q
	-- Write to .part then rename, so an agent never reads a half-uploaded file.
	return prep .. "ssh " .. PASTE_HOST .. " "
		.. shq("cat > " .. name .. ".part && mv " .. name .. ".part " .. name)
		.. " < " .. up .. (tmp and (" && rm -f " .. q .. " " .. q .. ".png") or "")
end

herdr_upload_log = {} -- recent { started, finished, code } for debugging paste latency
local function runUpload(cmd)
	local entry = { started = hs.timer.secondsSinceEpoch() }
	table.insert(herdr_upload_log, entry)
	if #herdr_upload_log > 20 then
		table.remove(herdr_upload_log, 1)
	end
	hs.task
		.new("/bin/sh", function(code, _, err)
			entry.finished, entry.code = hs.timer.secondsSinceEpoch(), code
			if code ~= 0 then
				hs.alert.show("Image upload to ag failed: " .. (err or ""), 5)
			end
		end, { "-c", cmd })
		:start()
end

-- Debounced: CleanShot writes, then may rewrite (annotations). Upload 50ms after the last
-- event, reusing the same remote name so the path you pasted stays valid.
local preuploadTimers = {}
local function preupload(path)
	local ext = (path:match("%.(%w+)$") or ""):lower()
	local base = path:match("[^/]+$")
	if not IMAGE_EXT[ext] or base:sub(1, 1) == "." then
		return
	end
	if not preuploaded[path] then
		local name = string.format("%s/%s-%s.%s", PASTE_DIR, os.date("%Y%m%d-%H%M%S"), hs.host.uuid():sub(1, 6), ext)
		preuploaded[path] = PASTE_REMOTE_HOME .. "/" .. name
	end
	local name = preuploaded[path]:sub(#PASTE_REMOTE_HOME + 2)
	if preuploadTimers[path] then
		preuploadTimers[path]:stop()
	end
	preuploadTimers[path] = hs.timer.doAfter(0.05, function()
		preuploadTimers[path] = nil
		if hs.fs.attributes(path) then
			runUpload(uploadCmd(path, name))
		end
	end)
end

-- Insert text as one terminal paste (keyStrokes sends one event per character, which
-- is slow through remote Herdr). Swap the clipboard, send Cmd+V, restore it.
local pastingText = false
local function pasteText(text)
	local saved = hs.pasteboard.readAllData()
	hs.pasteboard.setContents(text)
	pastingText = true
	hs.eventtap.keyStroke({ "cmd" }, "v", 0)
	hs.timer.doAfter(0.3, function()
		pastingText = false
		hs.pasteboard.writeAllData(saved)
	end)
end

local function pasteImagesToHerdr(images)
	local stamp = os.date("%Y%m%d-%H%M%S")
	local remote, cmd = {}, {}
	for i, im in ipairs(images) do
		if preuploaded[im.src] then
			table.insert(remote, preuploaded[im.src])
		else
			local name = string.format("%s/%s-%d.%s", PASTE_DIR, stamp, i, im.ext)
			table.insert(remote, PASTE_REMOTE_HOME .. "/" .. name)
			table.insert(cmd, uploadCmd(im.src, name, im.convert, im.tmp))
		end
	end
	pasteText(table.concat(remote, " ") .. " ")
	if #cmd > 0 then
		runUpload(table.concat(cmd, " && "))
	end
end
herdr_paste_images = function() -- debug/test entry point: same as Cmd+V in herdr
	local images = clipboardImages()
	if images then
		pasteImagesToHerdr(images)
	end
	return images ~= nil
end

-- Keep the ssh master warm so the first paste is fast too.
if not IS_HOST then
	herdr_ssh_warm = hs.timer.doEvery(600, function()
		hs.task.new("/bin/sh", nil, { "-c", "mkdir -p ~/.ssh/sockets && { ssh -O check " .. PASTE_HOST .. " 2>/dev/null || ssh -fN " .. PASTE_HOST .. "; } && ssh " .. PASTE_HOST .. " mkdir -p " .. PASTE_DIR }):start()
	end)
	herdr_ssh_warm:fire()

	-- Watch CleanShot's capture folders (media history holds the copied PNG; ~/Screenshots
	-- gets the saved one). Only files created after startup are uploaded.
	local started = os.time()
	herdr_capture_watchers = {}
	for _, dir in ipairs({ os.getenv("HOME") .. "/Library/Application Support/CleanShot/media", os.getenv("HOME") .. "/Screenshots" }) do
		local w = hs.pathwatcher.new(dir, function(paths, flags)
			for i, p in ipairs(paths) do
				local f = flags[i]
				if (f.itemCreated or f.itemRenamed or f.itemModified) and f.itemIsFile then
					local attrs = hs.fs.attributes(p)
					if attrs and attrs.size > 0 and attrs.creation >= started then
						preupload(p)
					end
				end
			end
		end)
		w:start()
		table.insert(herdr_capture_watchers, w)
	end
end

if not IS_HOST then
	herdr_image_paste_tap = hs.eventtap
		.new({ hs.eventtap.event.types.keyDown }, function(evt)
			if pastingText or hs.keycodes.map[evt:getKeyCode()] ~= "v" or not flagsMatch(evt:getFlags(), { cmd = true }) then
				return false
			end
			if not focusedWindowIsHerdr() then
				return false
			end
			local images = clipboardImages()
			if not images then
				return false
			end
			pasteImagesToHerdr(images)
			return true
		end)
		:start()
end
-- ────────────────────────────────────────────────────────────────────────────

-- ─── Herdr: clickable links to tabs ─────────────────────────────────────────
-- Agents print gemini://<host>/focus/<tab_id> (see `herdr-link`). Cmd+click in Ghostty →
-- HerdrLink.app (macos-apps/HerdrLink, the gemini:// handler) → hammerspoon://herdr?tab=&host=
-- → here: focus that tab over the warm ssh connection. No browser involved.
hs.urlevent.bind("herdr", function(_, params)
	local tab, host = params.tab or "", params.host or "ag-mac"
	if not tab:match("^[%w]+:[%w]+$") or not host:match("^[%w%.%-]+$") then
		return hs.alert.show("herdr link: bad target")
	end
	-- "ag" is ag-mac's old name (links printed before the 2026-09-29 rename).
	local here = host == THIS_HOST or (IS_HOST and (host == "ag" or host == "ag-mac"))
	local focus = "$HOME/.local/bin/ag-mux tab focus " .. tab
	hs.task
		.new("/bin/sh", function(code, _, err)
			if code ~= 0 then
				hs.alert.show("herdr link failed: " .. (err or ""), 4)
			end
		end, { "-c", here and focus or ("ssh " .. host .. " '" .. focus .. "'") })
		:start()
	local ghostty = hs.application.find("Ghostty")
	if ghostty then
		ghostty:activate()
	end
end)
