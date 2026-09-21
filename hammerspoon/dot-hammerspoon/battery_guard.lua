-- Battery guard
-- `pmset disablesleep 1` (set in ../macos) means the Mac never sleeps, even
-- with the lid closed. This watcher is the safety net: when running on battery
-- below a threshold, temporarily allow sleep and sleep now, then re-arm
-- disablesleep on wake.
--
-- Requires passwordless sudo for pmset (installed by ../macos):
--   /etc/sudoers.d/pmset

local guard = {}

local LOW_BATTERY_PERCENT = 10

local function isOnBattery()
	return hs.battery.powerSource() == "Battery Power"
end

local function forceSleep()
	hs.alert.show("Battery low — sleeping")
	hs.execute("sudo -n pmset -a disablesleep 0 && pmset sleepnow")
end

local function rearm()
	hs.execute("sudo -n pmset -a disablesleep 1")
end

guard.batteryWatcher = hs.battery.watcher.new(function()
	local pct = hs.battery.percentage()
	if isOnBattery() and pct and pct <= LOW_BATTERY_PERCENT then
		forceSleep()
	end
end)
guard.batteryWatcher:start()

guard.wakeWatcher = hs.caffeinate.watcher.new(function(event)
	if event == hs.caffeinate.watcher.systemDidWake then
		rearm()
	end
end)
guard.wakeWatcher:start()

return guard
