import AppKit

/// A menu-bar app that publishes the beat of whatever plays to
/// ~/Library/Application Support/Mac Pulse/beat.json while a reader (Tape Club)
/// keeps beat.want fresh. The audio tap runs only while someone reads.
final class AppDelegate: NSObject, NSApplicationDelegate {
    let audio = AudioTap()
    let feed = BeatFeed()
    var item: NSStatusItem?
    let status = NSMenuItem(title: "Waiting for Tape Club to ask for the beat", action: nil, keyEquivalent: "")

    func applicationDidFinishLaunching(_ notification: Notification) {
        audio.onFrame = { [weak self] bands in self?.feed.consume(bands) }
        feed.onWantChange = { [weak self] in self?.update() }
        feed.start()

        let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        item.button?.title = "♩"
        let menu = NSMenu()
        menu.addItem(status)
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        self.item = item
    }

    func update() {
        if feed.wanted && !audio.running { audio.start() }
        if !feed.wanted && audio.running { audio.stop() }
        item?.button?.title = feed.wanted ? "♫" : "♩"
        status.title = feed.wanted ? "Listening to the music for Tape Club" : "Waiting for Tape Club to ask for the beat"
    }

    func applicationWillTerminate(_ notification: Notification) { audio.stop() }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
