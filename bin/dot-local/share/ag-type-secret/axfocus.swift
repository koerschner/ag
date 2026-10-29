// axfocus: where would keystrokes land right now? Prints one line for the frontmost
// app's focused UI element, fields separated by U+001F (so empty ones survive a shell `read`):
// bundle id, pid, role, subrole, and the URL of the web page containing it
// (empty when the focus isn't inside a web page, e.g. a browser's address bar or other app UI).
// Used by ag-type-secret --host. Reads the frontmost process directly through the Accessibility API,
// so it stays right when several instances of the same browser are running.
import AppKit
import ApplicationServices

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var v: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &v) == .success ? v : nil
}

func element(_ v: CFTypeRef?) -> AXUIElement? {
    guard let v = v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
    return unsafeBitCast(v, to: AXUIElement.self)
}

func text(_ v: CFTypeRef?) -> String {
    guard let v = v else { return "" }
    if CFGetTypeID(v) == CFURLGetTypeID() { return (unsafeBitCast(v, to: CFURL.self) as URL).absoluteString }
    return (v as? String) ?? ""
}

guard let front = NSWorkspace.shared.frontmostApplication else { exit(1) }
let pid = front.processIdentifier
var role = "", subrole = "", url = ""
if var el = element(attr(AXUIElementCreateApplication(pid), kAXFocusedUIElementAttribute)) {
    role = text(attr(el, kAXRoleAttribute))
    subrole = text(attr(el, kAXSubroleAttribute))
    for _ in 0..<200 {
        if text(attr(el, kAXRoleAttribute)) == "AXWebArea" {
            url = text(attr(el, "AXURL"))
            break
        }
        guard let parent = element(attr(el, kAXParentAttribute)) else { break }
        el = parent
    }
}
print([front.bundleIdentifier ?? "", String(pid), role, subrole, url].joined(separator: "\u{1F}"))
