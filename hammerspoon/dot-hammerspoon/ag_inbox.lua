-- ─── ag inbox: quick capture (Cmd+Shift+Space) ────────────────────────────────
-- Press Cmd+Shift+Space anywhere: the current screen is snapshotted (before the form
-- appears, so the form isn't in it) and a small prompt form opens instantly. Type,
-- Enter to send (Shift+Enter = newline), Esc to cancel. Click the screenshot to
-- annotate it in CleanShot; Cmd+S there saves it back and the form picks it up.
--
-- Send POSTs the prompt + screenshot to the ag inbox (ag-inbox, http://ag-mac:7373/prompt),
-- which opens a new pi session in Herdr's Inbox workspace. The ag inbox asks Jev
-- whether the prompt needs the screenshot; an annotated screenshot is always attached.
-- If Jev judges it new context for an open session, it goes to that session instead.
--
-- Speed: the webview is built once at load and only shown/hidden, so it opens with no
-- WebKit startup cost. The screenshot is written to disk only on send/annotate.
local M = {}

local URL = "http://ag-mac:7373/prompt"
local DIR = os.getenv("HOME") .. "/Library/Caches/ag-inbox"
local W, H, THUMB_W = 560, 330, 480
hs.fs.mkdir(DIR)

local state = {} -- one capture: prevApp, app, window, img, path, annotated, watcher
local view

local HTML = [[
<!doctype html>
<html><head><meta charset="utf-8">
<style>
	:root { color-scheme: light dark; }
	* { box-sizing: border-box; }
	html, body { height: 100%; margin: 0; }
	body {
		font: 14px -apple-system, BlinkMacSystemFont, sans-serif;
		background: #f5f5f7; color: #1d1d1f; overflow: hidden;
		display: flex; flex-direction: column; gap: 10px; padding: 14px;
	}
	#shot { display: flex; gap: 12px; align-items: center; }
	#shot.hidden { display: none; }
	#thumb {
		height: 96px; border-radius: 8px; cursor: pointer;
		border: 1px solid rgba(0,0,0,.15); box-shadow: 0 1px 3px rgba(0,0,0,.15);
	}
	#thumb:hover { outline: 3px solid rgba(0,122,255,.5); }
	#shotNote { color: #6e6e73; font-size: 12px; line-height: 1.4; }
	textarea {
		flex: 1; width: 100%; resize: none; font: inherit; line-height: 1.4;
		border: 1px solid #d2d2d7; border-radius: 10px; padding: 10px 12px;
		background: white; color: inherit; outline: none;
	}
	textarea:focus { border-color: #007aff; box-shadow: 0 0 0 3px rgba(0,122,255,.18); }
	.footer { display: flex; align-items: center; gap: 10px; }
	.hint { flex: 1; color: #86868b; font-size: 12px; }
	button { border: 0; border-radius: 8px; padding: 7px 16px; font: inherit; font-weight: 600; cursor: pointer; }
	.secondary { background: #e8e8ed; color: #1d1d1f; }
	.primary { background: #007aff; color: white; }
	@media (prefers-color-scheme: dark) {
		body { background: #1c1c1e; color: #f5f5f7; }
		#shotNote, .hint { color: #a1a1a6; }
		textarea { background: #2c2c2e; border-color: #48484a; }
		.secondary { background: #3a3a3c; color: #f5f5f7; }
	}
</style></head>
<body>
	<div id="shot" class="hidden">
		<img id="thumb" title="Annotate in CleanShot">
		<div id="shotNote"></div>
	</div>
	<textarea id="prompt" placeholder="Prompt for a new ag session…"></textarea>
	<div class="footer">
		<span class="hint">↩ send · ⇧↩ newline · esc cancel</span>
		<button class="secondary" id="cancel">Cancel</button>
		<button class="primary" id="send">Send</button>
	</div>
<script>
	const prompt = document.getElementById('prompt');
	const post = (m) => webkit.messageHandlers.aginbox.postMessage(m);
	const send = () => post({ action: 'send', text: prompt.value });
	const NOTE_AUTO = 'Attached if the prompt needs it.<br>Click to annotate.';
	const NOTE_ANNOTATED = 'Annotated: will be attached.<br>Click to edit again.';
	function reset(s) {
		prompt.value = '';
		document.getElementById('shot').className = s.thumb ? '' : 'hidden';
		if (s.thumb) document.getElementById('thumb').src = s.thumb;
		document.getElementById('shotNote').innerHTML = NOTE_AUTO;
		prompt.focus();
	}
	function annotated(thumb) {
		document.getElementById('thumb').src = thumb;
		document.getElementById('shotNote').innerHTML = NOTE_ANNOTATED;
		prompt.focus();
	}
	document.getElementById('thumb').addEventListener('click', () => post({ action: 'annotate' }));
	document.getElementById('send').addEventListener('click', send);
	document.getElementById('cancel').addEventListener('click', () => post({ action: 'cancel' }));
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') { e.preventDefault(); post({ action: 'cancel' }); }
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
	});
</script>
</body></html>
]]

local function js(code)
	view:evaluateJavaScript(code)
end

local function thumbnail(img)
	local s = img:size()
	return img:copy():size({ w = THUMB_W, h = math.floor(THUMB_W * s.h / s.w) }):encodeAsURLString(true, "JPEG")
end

-- Write the screenshot once (1x JPEG, ~0.4 MB). Later calls return the same file, which
-- CleanShot may have overwritten with an annotated version.
local function shotPath()
	if not state.img then
		return nil
	end
	if not state.path then
		state.path = string.format("%s/%s-%s.jpg", DIR, os.date("%Y%m%d-%H%M%S"), hs.host.uuid():sub(1, 6))
		state.img:saveToFile(state.path, true, "jpg")
	end
	return state.path
end

local function focusForm()
	view:show()
	hs.focus() -- activate Hammerspoon (~2 ms; hswindow():focus() takes ~300 ms)
	js("prompt.focus()")
end

local function close()
	if state.watcher then
		state.watcher:stop()
	end
	local prev = state.prevApp
	state = {}
	view:hide()
	if prev then
		prev:activate() -- back to where you were (its key window comes forward)
	end
end

local function send(text)
	text = (text or ""):gsub("^%s+", ""):gsub("%s+$", "")
	if text == "" then
		return
	end
	local args = { "-sS", "-m", "60", "-o", "/dev/null", "-w", "%{http_code}", "--form-string", "text=" .. text }
	local path = shotPath()
	if path then
		table.insert(args, "-F")
		table.insert(args, "screenshot=@" .. path .. ";type=image/jpeg")
		for k, v in pairs({ app = state.app, window = state.window, attach = state.annotated and "always" or nil }) do
			table.insert(args, "--form-string")
			table.insert(args, k .. "=" .. v)
		end
	end
	table.insert(args, URL)
	-- The upload (~0.4 MB) finishes in the background after the form is gone.
	hs.task
		.new("/usr/bin/curl", function(code, out, err)
			local status = tonumber(out) or 0
			if code == 0 and status >= 200 and status < 400 then
				if path then
					os.remove(path)
				end
			else
				hs.pasteboard.setContents(text)
				hs.alert.show("ag inbox: send failed (" .. (err ~= "" and err or status) .. "). Prompt copied to clipboard.", 6)
			end
		end, args)
		:start()
	close()
end

-- Open the screenshot in CleanShot's editor. Its Cmd+S overwrites the file in place;
-- watch for that and show the annotated version.
local function annotate()
	local path = shotPath()
	if not path then
		return
	end
	if not state.watcher then
		local mtime = hs.fs.attributes(path, "modification")
		local debounce
		state.watcher = hs.pathwatcher
			.new(path, function()
				if debounce then
					debounce:stop()
				end
				debounce = hs.timer.doAfter(0.3, function()
					local now = hs.fs.attributes(path, "modification")
					local img = now and now ~= mtime and hs.image.imageFromPath(path)
					if img and state.path == path then
						mtime = now
						state.annotated = true
						js("annotated(" .. hs.json.encode({ thumbnail(img) }):sub(2, -2) .. ")")
						focusForm()
					end
				end)
			end)
			:start()
	end
	hs.urlevent.openURL("cleanshot://open-annotate?filepath=" .. hs.http.encodeForQuery(path))
end

local function build()
	local controller = hs.webview.usercontent.new("aginbox"):setCallback(function(msg)
		local body = msg.body or {}
		if body.action == "send" then
			send(body.text)
		elseif body.action == "cancel" then
			close()
		elseif body.action == "annotate" then
			annotate()
		end
	end)
	view = hs.webview.new({ x = 0, y = 0, w = W, h = H }, {}, controller)
	view:windowTitle("ag inbox")
	view:windowStyle({ "titled", "utility" }) -- no close button: Cancel/Esc reset the capture
	view:allowTextEntry(true)
	view:deleteOnClose(false)
	view:closeOnEscape(false)
	view:shadow(true)
	view:html(HTML)
	M.view = view -- for debugging from `hs -c`
end

function M.open()
	if view:isVisible() then
		return focusForm()
	end
	local win = hs.window.focusedWindow()
	local screen = (win and win:screen()) or hs.screen.mainScreen()
	local snap = screen:snapshot() -- nil without Screen Recording permission
	local f = screen:fullFrame()
	local front = hs.application.frontmostApplication()
	state = {
		prevApp = front,
		-- Ghostty windows aren't visible to hs.window (win is nil); the app name still is.
		app = front and front:name() or "",
		window = win and win:title() or "",
		img = snap and snap:copy():size({ w = f.w, h = f.h }),
	}
	js("reset(" .. hs.json.encode({ thumb = snap and thumbnail(snap) or false }) .. ")")
	local sf = screen:frame()
	view:frame({ x = sf.x + (sf.w - W) / 2, y = sf.y + sf.h * 0.22, w = W, h = H })
	focusForm()
end

build()
M.hotkey = hs.hotkey.bind({ "cmd", "shift" }, "space", M.open)

return M
