// cursorlog — log the mouse cursor for ag-rec: position at a steady rate plus clicks/scrolls.
//
//   cursorlog <out.csv> [hz]
//
// Writes CSV lines `t,kind,x,y` with t = Unix epoch seconds and x,y in global display points
// (top-left origin, same as CGEvent). kind: m = position sample, d/u = left down/up,
// D/U = right down/up, s = scroll. First lines are `#` comments with the screen layout.
// Clicks come from a listen-only CGEvent tap (needs Input Monitoring, which agents' TCC
// identity on ag-mac has); if the tap can't be created it falls back to polling the buttons.
// Stops cleanly on SIGINT/SIGTERM.
import AppKit
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 2, let out = fopen(args[1], "w") else {
    FileHandle.standardError.write("usage: cursorlog <out.csv> [hz]\n".data(using: .utf8)!)
    exit(2)
}
let hz = args.count >= 3 ? Double(args[2]) ?? 60 : 60
enum Log {  // static, so the C event-tap callback can reach it without capturing context
    static var file: UnsafeMutablePointer<FILE>!
    static func now() -> Double { Date().timeIntervalSince1970 }
    static func emit(_ kind: String, _ p: CGPoint, _ t: Double = now()) {
        fputs(String(format: "%.4f,%@,%.1f,%.1f\n", t, kind, p.x, p.y), file)
    }
}
Log.file = out
let f = out
setvbuf(f, nil, _IOLBF, 0)

// Screen layout in global top-left points, so the exporter can map points to video pixels.
let mainH = NSScreen.screens.first?.frame.height ?? 0
for (i, s) in NSScreen.screens.enumerated() {
    let r = s.frame
    fputs(String(format: "#screen %d %.0f %.0f %.0f %.0f %.1f\n", i, r.origin.x,
                 mainH - r.origin.y - r.height, r.width, r.height, s.backingScaleFactor), f)
}
fputs("t,kind,x,y\n", f)

var usingTap = false
let mask: CGEventMask = [CGEventType.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp,
                         .scrollWheel].reduce(0) { $0 | (1 << $1.rawValue) }
let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                            eventsOfInterest: mask, callback: { _, type, event, _ in
    let k: String
    switch type {
    case .leftMouseDown: k = "d"
    case .leftMouseUp: k = "u"
    case .rightMouseDown: k = "D"
    case .rightMouseUp: k = "U"
    case .scrollWheel: k = "s"
    default: return Unmanaged.passUnretained(event)  // tap disabled/timeout notices
    }
    Log.emit(k, event.location)
    return Unmanaged.passUnretained(event)
}, userInfo: nil)
if let tap = tap {
    let src = CFMachPortCreateRunLoopSource(nil, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    usingTap = true
}
fputs("#clicks \(usingTap ? "eventtap" : "polling")\n", f)

var lastButtons = 0
var lastPos = CGPoint(x: -1, y: -1)
var lastEmit = 0.0
let timer = Timer(timeInterval: 1 / hz, repeats: true) { _ in
    let p = CGEvent(source: nil)?.location ?? .zero
    let t = Log.now()
    // Always sample while moving; when still, one keepalive sample a second keeps the file small.
    if p != lastPos || t - lastEmit > 1 { Log.emit("m", p, t); lastPos = p; lastEmit = t }
    if !usingTap {
        let b = NSEvent.pressedMouseButtons
        if b & 1 != lastButtons & 1 { Log.emit(b & 1 != 0 ? "d" : "u", p, t) }
        if b & 2 != lastButtons & 2 { Log.emit(b & 2 != 0 ? "D" : "U", p, t) }
        lastButtons = b
    }
}
RunLoop.main.add(timer, forMode: .common)

for sig in [SIGINT, SIGTERM] {
    signal(sig, SIG_IGN)
    let s = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    s.setEventHandler { fflush(f); fclose(f); exit(0) }
    s.resume()
    objc_setAssociatedObject(timer, "\(sig)", s, .OBJC_ASSOCIATION_RETAIN)
}
RunLoop.main.run()
