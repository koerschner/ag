// HerdrLink: handles gemini://<host>/focus/<tab_id> links (Cmd+click in Ghostty) by handing
// them to Hammerspoon (hammerspoon://herdr?tab=<id>&host=<host>), which focuses the Herdr tab.
// No browser involved. Stays resident (LSUIElement) so repeat clicks are instant.
// Why gemini://: Ghostty only auto-links a fixed list of schemes, Herdr strips OSC 8 links,
// and nothing else on these Macs uses gemini://. Build/install: ./install.sh
import AppKit

final class Handler: NSObject, NSApplicationDelegate {
	func applicationWillFinishLaunching(_ n: Notification) {
		NSAppleEventManager.shared().setEventHandler(
			self, andSelector: #selector(handle(_:reply:)),
			forEventClass: AEEventClass(kInternetEventClass), andEventID: AEEventID(kAEGetURL))
	}

	@objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
		guard let s = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
			let u = URLComponents(string: s), let host = u.host else { return }
		let parts = u.path.split(separator: "/").map(String.init)
		guard parts.count == 2, parts[0] == "focus" else { return }
		var out = URLComponents(string: "hammerspoon://herdr")!
		out.queryItems = [URLQueryItem(name: "tab", value: parts[1]), URLQueryItem(name: "host", value: host)]
		guard let target = out.url,
			let hs = NSWorkspace.shared.urlForApplication(withBundleIdentifier: "org.hammerspoon.Hammerspoon") else { return }
		let cfg = NSWorkspace.OpenConfiguration()
		cfg.activates = false
		NSWorkspace.shared.open([target], withApplicationAt: hs, configuration: cfg)
	}
}

let app = NSApplication.shared
let delegate = Handler()
app.delegate = delegate
app.setActivationPolicy(.prohibited)
app.run()
