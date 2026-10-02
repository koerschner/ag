-- Persistent desktop alerts for stalled pinned (📌) sessions, so pinned items always stay in motion.
-- Client only (loaded from ag.lua). Polls AG Dash's /api/pinned: every pinned card whose agent isn't working
-- (done, idle or blocked; not waiting) gets a macOS alert that stays on screen. Hammerspoon's notification
-- style is "Alerts" (its Info.plist default; System Settings › Notifications › Hammerspoon), so it doesn't
-- auto-dismiss. The alert is withdrawn the moment the item is addressed: the agent works again, the card is
-- marked waiting, or it's unpinned. Open jumps to the session in AG Dash. If Nathan closes or opens it
-- and the agent is still stalled RESURFACE_S later, it comes back.
local M = {}

local URL = "http://ag:7376/api/pinned"
local POLL_S = 5
local RESURFACE_S = 10 * 60

M.alerts = {} -- tab → { key, note, postedAt }

local function post(card)
	local note = hs.notify.new(function()
		hs.urlevent.openURL(card.url)
	end, {
		title = "📌 " .. card.title,
		subTitle = card.workspace,
		informativeText = card.body,
		hasActionButton = true,
		actionButtonTitle = "Open",
		otherButtonTitle = "Later",
		withdrawAfter = 0,
		soundName = hs.notify.defaultNotificationSound,
	})
	note:send()
	return note
end

local function onScreen(note)
	for _, n in ipairs(hs.notify.deliveredNotifications()) do
		if n:title() == note:title() then return true end
	end
	return false
end

local function sync(cards)
	local live = {}
	for _, card in ipairs(cards) do
		live[card.tab] = true
		-- A new stall (status changed since) is a new alert; the same stall keeps its alert.
		local key = card.status .. "@" .. tostring(card.since)
		local a = M.alerts[card.tab]
		if not a or a.key ~= key then
			if a then a.note:withdraw() end
			M.alerts[card.tab] = { key = key, note = post(card), postedAt = os.time() }
		elseif os.time() - a.postedAt >= RESURFACE_S and not onScreen(a.note) then
			a.note:withdraw()
			a.note, a.postedAt = post(card), os.time()
		end
	end
	for tab, a in pairs(M.alerts) do
		if not live[tab] then
			a.note:withdraw()
			M.alerts[tab] = nil
		end
	end
end

local function poll()
	hs.http.asyncGet(URL, nil, function(status, body)
		if status ~= 200 then return end -- AG Dash unreachable: keep what's showing
		local ok, cards = pcall(hs.json.decode, body)
		if ok and type(cards) == "table" then sync(cards) end
	end)
end

-- Alerts from before a reload have no callbacks and no tracking: clear them, the first poll reposts.
hs.notify.withdrawAll()
M.timer = hs.timer.doEvery(POLL_S, poll)
poll()

return M
